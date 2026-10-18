// Anonymous guest tokens, guest cart staging and progressive cart merge (D2 FR-4.2–4.4, 5.7).
const crypto = require('crypto');
const { registerReset } = require('../seed');
const registry = require('../state/registry');
const { guestToken, guestWriteError } = require('../auth/guest');
const { ApiError } = require('../utils/errors');
const { canonical, signDay2 } = require('../utils/sign');

const staging = new Map(); // guest_token -> [{ variant_id, quantity }]
registerReset(() => staging.clear());

const tokens = () => registry.state.guestTokens;
const isStr = (v) => typeof v === 'string' && v.length > 0;

function issueToken() {
  const token = `guest_anon_tok_${crypto.randomBytes(8).toString('hex')}`;
  const expires = new Date(Date.now() + 2 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  tokens().set(token, { token, merged: false, merge_key: null, response: null, anonymized: false, expires_at: expires });
  return { guest_token: token, role: 'guest', scope: ['stream:read', 'score:subscribe', 'cart:stage'], expires_at: expires };
}

function stageItem(token, variantId, quantity) {
  if (!isStr(token) || !token.startsWith('guest_')) throw new ApiError(400, 'VALIDATION_ERROR', 'guest_token required', { fields: ['guest_token'] });
  if (!Number.isInteger(quantity) || quantity < 1) throw new ApiError(400, 'VALIDATION_ERROR', 'quantity must be >= 1', { fields: ['quantity'] });
  if (!registry.state.variants.has(variantId)) throw new ApiError(404, 'VARIANT_NOT_FOUND', `Variant ${variantId} not found`, { variant_id: variantId });
  const items = staging.get(token) || [];
  const existing = items.find((i) => i.variant_id === variantId);
  if (existing) existing.quantity += quantity; else items.push({ variant_id: variantId, quantity });
  staging.set(token, items);
  return cartView(token, items);
}

function cartView(token, items) {
  return { guest_token: token, items, total_items: items.reduce((s, i) => s + i.quantity, 0) };
}

const stagedCart = (token) => cartView(token, staging.get(token) || []);

function activeCart(userId) {
  const items = registry.state.carts.get(userId).items.map((i) => ({
    variant_id: i.variant_id, quantity: i.quantity, unit_price_minor: registry.state.variants.get(i.variant_id).price_minor,
  }));
  return {
    user_id: userId,
    currency: 'PKR',
    total_items: items.reduce((s, i) => s + i.quantity, 0),
    subtotal_minor: items.reduce((s, i) => s + i.quantity * i.unit_price_minor, 0),
    items,
  };
}

function validateMerge(body) {
  const fields = [];
  if (!isStr(body.guest_token) || !body.guest_token.startsWith('guest_')) fields.push('guest_token');
  if (!isStr(body.registered_user_id)) fields.push('registered_user_id');
  const cart = body.guest_cart;
  if (!Array.isArray(cart) || cart.length < 1 || cart.length > 10) fields.push('guest_cart');
  else cart.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || !isStr(item.variant_id)) fields.push(`guest_cart[${i}].variant_id`);
    if (!item || !Number.isInteger(item.quantity) || item.quantity < 1) fields.push(`guest_cart[${i}].quantity`);
  });
  if (body.test_write_block !== undefined && typeof body.test_write_block !== 'boolean') fields.push('test_write_block');
  if (fields.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid cart merge request', { fields });
}

// Fully synchronous: concurrent replays cannot interleave between the check and the merge.
function merge(body) {
  validateMerge(body);
  const { guest_token: token, registered_user_id: userId, guest_cart: cart } = body;
  const testWriteBlock = body.test_write_block ?? true;

  if (!registry.state.users.has(userId)) throw new ApiError(404, 'PLAYER_NOT_FOUND', `User ${userId} not found`, { registered_user_id: userId });
  for (const item of cart) {
    if (!registry.state.variants.has(item.variant_id)) throw new ApiError(404, 'VARIANT_NOT_FOUND', `Variant ${item.variant_id} not found`, { variant_id: item.variant_id });
  }

  // Network-migration replay (edge case 4) is answered from the stored result before any stock math.
  const mergeKey = canonical({ token, userId, cart });
  const record = tokens().get(token);
  if (record?.merged) {
    if (record.merge_key === mergeKey) return { status: 200, body: record.response };
    throw new ApiError(409, 'GUEST_TOKEN_ALREADY_MERGED', 'This guest token has already been merged', { guest_token: token });
  }

  const userCart = registry.state.carts.get(userId);
  const wanted = new Map();
  for (const i of userCart.items) wanted.set(i.variant_id, (wanted.get(i.variant_id) || 0) + i.quantity);
  for (const i of cart) wanted.set(i.variant_id, (wanted.get(i.variant_id) || 0) + i.quantity);
  for (const [variantId, qty] of wanted) {
    if (qty > registry.state.variants.get(variantId).stock) {
      throw new ApiError(409, 'OUT_OF_STOCK', `Variant ${variantId} does not have ${qty} units available`, { variant_id: variantId });
    }
  }

  let writeRejectionCode = null;
  if (testWriteBlock) {
    const fakeReq = { headers: { authorization: `Bearer ${token}` } };
    if (guestToken(fakeReq)) writeRejectionCode = guestWriteError(token).status;
  }

  for (const i of cart) {
    const existing = userCart.items.find((x) => x.variant_id === i.variant_id);
    if (existing) existing.quantity += i.quantity; else userCart.items.push({ variant_id: i.variant_id, quantity: i.quantity });
  }
  const active = activeCart(userId);
  const response = {
    guest_token: token,
    write_block_verified: writeRejectionCode === 403,
    write_rejection_code: writeRejectionCode,
    cart_merged: true,
    active_cart: active,
    signature: signDay2(token, {
      cart_merged: true, guest_token: token, registered_user_id: userId, total_items: active.total_items, write_rejection_code: writeRejectionCode,
    }),
  };
  tokens().set(token, { ...(record || { token, anonymized: false }), merged: true, merged_user_id: userId, merge_key: mergeKey, response });
  staging.delete(token);
  return { status: 200, body: response };
}

module.exports = { issueToken, stageItem, stagedCart, activeCart, merge };
