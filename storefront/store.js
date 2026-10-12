// House of Spells storefront -> backend client (same origin as the store API)
async function storeGet(path) {
  const r = await fetch('/store' + path);
  if (!r.ok) throw new Error('store ' + r.status);
  return r.json();
}
let _vtoken = null;
try { _vtoken = sessionStorage.getItem('vs_token'); } catch (e) {}
async function shopGql(query, variables) {
  const headers = { 'content-type': 'application/json' };
  if (_vtoken) headers['Authorization'] = 'Bearer ' + _vtoken;
  const r = await fetch('/shop-api', { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const t = r.headers.get('vendure-auth-token');
  if (t) { _vtoken = t; try { sessionStorage.setItem('vs_token', t); } catch (e) {} }
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message);
  return j.data;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Struck-through MRP + "% off" badge (only when the API supplies a genuine MRP for the item).
function mrpHtml(p) {
  if (!p || !p.mrp || !(p.mrp > p.price)) return '';
  return '<span class="hs-mrp" title="MRP">MRP ₹' + Math.round(p.mrp).toLocaleString('en-IN') + '</span>' +
         '<span class="hs-off">' + (p.off || Math.round((1 - p.price / p.mrp) * 100)) + '% off</span>';
}
