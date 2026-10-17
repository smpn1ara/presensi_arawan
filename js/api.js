// ============================================================================
// api.js — Pengganti google.script.run untuk GAS sebagai REST API
// Pemakaian sama seperti sebelumnya:
//   gas.run.withSuccessHandler(ok).withFailureHandler(gagal).namaFungsi(arg1, arg2)
// Di balik layar: fetch POST (text/plain agar tidak memicu CORS preflight)
// ============================================================================
(function () {
  'use strict';

  const TIMEOUT_MS = 120000; // 2 menit (export/rekap besar bisa lama)

  async function panggilServer(fnName, args) {
    if (typeof GAS_URL === 'undefined' || !GAS_URL || GAS_URL.indexOf('PASTE_URL') === 0) {
      throw new Error('GAS_URL belum diisi. Edit js/config.js lalu isi URL /exec.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        // WAJIB text/plain — application/json memicu preflight yang ditolak GAS
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ rpc: 1, fnName: fnName, args: args }),
        signal: ctrl.signal
      });
      let data;
      try { data = await res.json(); }
      catch (_) { throw new Error('Balasan server bukan JSON (cek deploy GAS: akses "Anyone", dan sudah deploy ulang).'); }
      if (!data || data.__rpc !== true) throw new Error((data && data.message) || 'Balasan server tidak dikenali.');
      if (!data.ok) throw new Error(data.error || 'Server menolak permintaan.');
      return data.result;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('Waktu tunggu habis. Periksa koneksi lalu coba lagi.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function buatRunner(onOk, onFail, userObj) {
    const target = {};
    return new Proxy(target, {
      get(_, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        if (prop === 'withSuccessHandler')  return fn => buatRunner(fn, onFail, userObj);
        if (prop === 'withFailureHandler')  return fn => buatRunner(onOk, fn, userObj);
        if (prop === 'withUserObject')      return o  => buatRunner(onOk, onFail, o);
        return function (...args) {
          panggilServer(prop, args).then(
            result => { if (typeof onOk === 'function') onOk(result, userObj); },
            err => {
              if (typeof onFail === 'function') onFail(err, userObj);
              else console.error('[gas.run] ' + prop + ' gagal:', err);
            }
          );
        };
      }
    });
  }

  window.gas = { run: buatRunner(null, null, undefined), panggilServer: panggilServer };
})();
