// ============================================================
// House of Spells — Shared Cart Module
// Persists cart state via localStorage so it survives navigation
// between index.html, product.html, cart.html, and checkout.html.
// ============================================================

const CART_STORAGE_KEY = 'lunar_lore_cart_v1';

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (e) {
    // storage unavailable — fail silently, cart just won't persist
  }
}

let cart = loadCart();

function cartItemCount() {
  return Object.values(cart).reduce((s, i) => s + i.qty, 0);
}

function cartSubtotal() {
  return Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);
}

function addItemToCart(product, qty) {
  qty = qty || 1;
  const id = String(product.id);
  if (cart[id]) {
    cart[id] = { ...cart[id], qty: cart[id].qty + qty };
  } else {
    cart[id] = { id: product.id, name: product.name, price: product.price, image: product.image, slug: product.slug, qty: qty };
  }
  saveCart(cart);
  updateCartBadge();
}

function setItemQty(id, qty) {
  id = String(id);
  if (!cart[id]) return;
  if (qty <= 0) {
    delete cart[id];
  } else {
    cart[id].qty = qty;
  }
  saveCart(cart);
  updateCartBadge();
}

function changeItemQty(id, delta) {
  id = String(id);
  if (!cart[id]) return;
  setItemQty(id, cart[id].qty + delta);
}

function removeItemFromCart(id) {
  id = String(id);
  delete cart[id];
  saveCart(cart);
  updateCartBadge();
}

function clearCart() {
  cart = {};
  saveCart(cart);
  updateCartBadge();
}

function updateCartBadge() {
  const el = document.getElementById('cartCount');
  if (el) el.textContent = cartItemCount();
}

function fmtINR(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// Run on every page load
document.addEventListener('DOMContentLoaded', updateCartBadge);
