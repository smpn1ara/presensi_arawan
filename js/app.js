// Logika aplikasi Presensi — dari javaScript.html (google.script.run -> gas.run)
// ==========================================================================
    // 1. GLOBAL STATE & KONFIGURASI
    // ==========================================================================
    let DEPLOYMENT_URL = window.location.href.split('#')[0].split('?')[0];
    let currentUser = null;

    // ==========================================================================
    // GANTI LINK GAMBAR DI BAWAH INI UNTUK MENGGANTI BACKGROUND HALAMAN LOGIN
    // ==========================================================================
    const LOGIN_BACKGROUND_URL = 'https://cdn.phototourl.com/member/2026-07-24-240ed52f-edf8-4fb2-981c-ec2b52aec6b7.jpg';

    (function applyLoginBackground() {
        const bgEl = document.getElementById('loginBgImage');
        if (bgEl && LOGIN_BACKGROUND_URL) {
            bgEl.style.backgroundImage = "url('" + LOGIN_BACKGROUND_URL + "')";
        }
    })();

    let html5QrCode = null;
    let isScanning = false;
    let isSidebarOpen = true;

    // --- SCAN LIVE TABLE STATE ---
    let scanLiveCount = 0;
    let scanLiveMap = {}; // nis -> tr element 
    
    // --- SMART CACHE ---
    let appCache = {
        siswa: null,
        guru: null
    };

    // --- CHART & UTILS ---
    let dashboardChart = null;
    let existingClasses = []; // Untuk autocomplete kelas
    let guruChartInstance = null;
    let adminChartInstance = null;
    let mpAllData = []; // Cache master pelanggaran (Manajemen Pelanggaran)

    // Set Tanggal Hari Ini
    const dateElement = document.getElementById('currentDateDisplay');
    if (dateElement) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateElement.textContent = new Date().toLocaleDateString('id-ID', options);
    }

    const tableState = {
                siswa: { fullData: [], filtered: [], limit: 10, page: 1, search: '', classFilter: '' },
                // UPDATE BAGIAN INI: Tambahkan classFilter: ''
                guru: { fullData: [], filtered: [], limit: 10, page: 1, search: '', classFilter: '' },
                
                libur: { fullData: [], filtered: [], limit: 10, page: 1, search: '' },
                rekap: { fullData: [], filtered: [], limit: 10, page: 1, search: '' },
                monitoring: { fullData: [], filtered: [], limit: 10, page: 1, search: '', statusFilter: '', classFilter: '' },
                pelanggaran: { fullData: [], filtered: [], limit: 10, page: 1, search: '', classFilter: '', dateFrom: '', dateTo: '' }
            };

function handleTableSearch(type, query) {
        tableState[type].search = query.toLowerCase();
        tableState[type].page = 1; // Reset ke halaman 1 saat search
        processTableData(type);
    }

// FUNGSI BARU: Handle perubahan dropdown filter kelas
    function handleTableClassFilter(type, value) {
        if (tableState[type]) {
            tableState[type].classFilter = value;
            tableState[type].page = 1; // Reset ke halaman 1
            processTableData(type);
        }
    }
    
function handleTableStatusFilter(type, status) {
        if (tableState[type]) {
            tableState[type].statusFilter = status;
            tableState[type].page = 1; // Reset ke halaman 1
            processTableData(type);
        }
    }

    function handleTableLimit(type, limit) {
        tableState[type].limit = limit === 'all' ? Infinity : parseInt(limit);
        tableState[type].page = 1; // Reset ke halaman 1 saat ganti limit
        processTableData(type);
    }

    function handlePelanggaranDateFilter() {
        const dari = document.getElementById('plgFilterDari').value;
        const sampai = document.getElementById('plgFilterSampai').value;
        tableState.pelanggaran.dateFrom = dari;
        tableState.pelanggaran.dateTo = sampai;
        tableState.pelanggaran.page = 1;
        processTableData('pelanggaran');
    }

    function changePage(type, direction) {
        const state = tableState[type];
        const maxPage = Math.ceil(state.filtered.length / state.limit);
        const newPage = state.page + direction;
        
        if (newPage >= 1 && newPage <= maxPage) {
            state.page = newPage;
            processTableData(type);
        }
    }

function processTableData(type) {
        const state = tableState[type];
        
        // 1. Mulai dari data mentah (Full Data)
        let result = [...state.fullData];

        // 2. FILTER KHUSUS: KELAS (Untuk Siswa, Guru, dan Monitoring)
        if ((type === 'siswa' || type === 'guru' || type === 'monitoring' || type === 'pelanggaran') && state.classFilter) {
            result = result.filter(item => item.kelas === state.classFilter);
        }

        // 3. FILTER KHUSUS: STATUS KEHADIRAN (Untuk Monitoring)
        if (type === 'monitoring' && state.statusFilter) {
            result = result.filter(item => item.status === state.statusFilter);
        }

        // 3b. FILTER KHUSUS: RENTANG TANGGAL (Untuk Pelanggaran)
        if (type === 'pelanggaran') {
            if (state.dateFrom) result = result.filter(item => item.tanggal >= state.dateFrom);
            if (state.dateTo) result = result.filter(item => item.tanggal <= state.dateTo);
        }

        // 4. FILTER UMUM: PENCARIAN (SEARCH)
        if (state.search) {
            const query = state.search.toLowerCase();
            result = result.filter(item => 
                Object.values(item).some(val => 
                    String(val).toLowerCase().includes(query)
                )
            );
        }

        // 5. Simpan hasil penyaringan ke state
        state.filtered = result;

        // 6. LOGIKA PAGINASI
        const total = state.filtered.length;
        const totalPages = Math.ceil(total / state.limit);
        
        // Koreksi halaman jika melebihi total halaman (misal setelah search/filter)
        if (state.page > totalPages && totalPages > 0) state.page = totalPages;
        if (total === 0) state.page = 1;

        const startIdx = (state.page - 1) * state.limit;
        const endIdx = startIdx + state.limit;
        
        // Ambil data untuk halaman saat ini
        const pagedData = state.filtered.slice(startIdx, endIdx);

        // 7. RENDER TABEL (Pilih renderer berdasarkan tipe)
        if (type === 'siswa') renderSiswaRows(pagedData, startIdx);
        else if (type === 'guru') renderGuruRows(pagedData, startIdx);
        else if (type === 'libur') renderLiburRows(pagedData, startIdx);
        else if (type === 'rekap') renderRekapRows(pagedData);
        else if (type === 'monitoring') renderMonitoringRows(pagedData, startIdx);
        else if (type === 'pelanggaran') renderPelanggaranRows(pagedData, startIdx);

        // 8. UPDATE UI PAGINATION (Footer Tabel)
        updatePaginationUI(type, startIdx, pagedData.length, total, state.page, totalPages);
    }

    function updatePaginationUI(type, startIdx, currentCount, total, currentPage, totalPages) {
        const infoEl = document.getElementById(`info-${type}`);
        const btnPrev = document.getElementById(`btn-prev-${type}`);
        const btnNext = document.getElementById(`btn-next-${type}`);
        
        if (total === 0) {
            infoEl.textContent = 'Tidak ada data ditemukan.';
            btnPrev.disabled = true;
            btnNext.disabled = true;
        } else {
            const end = startIdx + currentCount;
            infoEl.textContent = `Menampilkan ${startIdx + 1} - ${end} dari ${total} data`;
            btnPrev.disabled = currentPage === 1;
            btnNext.disabled = currentPage >= totalPages;
        }
    }
    // ==========================================================================
    // 2. SESSION MANAGEMENT
    // ==========================================================================
    function checkSession() {
        const storedSession = localStorage.getItem('presensiAppSession');
        if (storedSession) {
            try {
                const sessionData = JSON.parse(storedSession);
                if (sessionData && sessionData.success) {
                    currentUser = sessionData;
                    document.getElementById('loginPage').classList.add('hidden');
                    document.getElementById('dashboardContainer').classList.remove('hidden');
                    
                    if (window.innerWidth < 768) {
                         document.getElementById('sidebar').classList.add('-translate-x-full');
                    }
                    
                    initDashboard();
                }
            } catch (e) {
                localStorage.removeItem('presensiAppSession');
            }
        }
    }

    // ==========================================================================
    // 3. UI NAVIGATION & SIDEBAR
    // ==========================================================================
    function showView(viewId) {
        // Hentikan kamera Daftar Hadir jika pindah ke halaman lain
        if (viewId !== 'view-daftar-hadir-guru' && typeof dhStopPopup === 'function') {
            dhStopPopup();
        }
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            el.style.display = 'none'; 
        });
        
        const target = document.getElementById(viewId);
        if (target) {
            target.classList.add('active');
            target.style.display = 'block'; 
            target.classList.add('animate-fade-in');
        }

        let title = "Dashboard";
        switch (viewId) {
            case 'view-data-siswa': title = "Direktori Siswa"; break;
            case 'view-manajemen-kelas': title = "Manajemen Kelas"; break;
            case 'view-data-guru': title = "Manajemen Guru"; break;
            case 'view-kelola-absen': title = "Kelola Hari Libur"; break; // JUDUL BARU
            case 'view-scanner': title = "Scan Presensi"; break;
            case 'view-daftar-hadir-guru': title = "Daftar Hadir"; break;
            case 'view-monitoring': title = "Monitoring Realtime"; break;
            case 'view-rekap-presensi': title = "Laporan Kehadiran"; break;
            case 'view-kartu-siswa': title = "Kartu Presensi Digital"; break;
            case 'view-pelanggaran': title = "Input Pelanggaran Siswa"; break;
            case 'view-sinkron-data': title = "Sinkron Data"; break;
        }
        document.getElementById('pageTitle').textContent = title;
        closeSidebarMobile();
    }

    function setActiveMenu(targetName) {
        const allLinks = document.querySelectorAll('#sidebarMenu a');
        
        const centerClass = !isSidebarOpen ? 'justify-center px-0' : 'space-x-3 px-4';
        const baseStyle = `flex items-center ${centerClass} py-3 rounded-xl transition-all duration-200 group overflow-hidden whitespace-nowrap cursor-pointer `;
        
        const activeStyle = "bg-orange-600 text-white shadow-lg shadow-orange-900/50";
        const inactiveStyle = "text-gray-400 hover:bg-gray-800 hover:text-white";

        allLinks.forEach(link => {
            const menuName = link.getAttribute('data-name');
            if (menuName === targetName) {
                link.className = baseStyle + activeStyle;
            } else {
                link.className = baseStyle + inactiveStyle;
            }
        });
    }

    // ==========================================================================
    // KERANGKA OFFLINE QUEUE + SINKRON DATA
    // Antrean aksi (absen masuk/pulang/sholat, pelanggaran, dll) disimpan dulu
    // di IndexedDB perangkat kalau lagi offline / gagal kirim, lalu dikirim ke
    // server satu-satu lewat menu "Sinkron Data". Tap kartu & scan barcode memakai mode
    // 'direct-first': langsung kirim ke server, baru masuk antrean kalau gagal/menumpuk.
    //
    // Cara pakai dari fitur lain (nanti dipasang di scanPresensi/sholat/pelanggaran):
    //   queueOfflineAction('Absen Masuk', 'scanPresensi', [nis, role, kelas], 'Budi (1A)')
    //     -> kalau lagi online, LANGSUNG dicoba kirim; kalau gagal/offline, disimpan ke antrean.
    // ==========================================================================
    // Jam ASLI perangkat saat aksi (scan) terjadi, format HH:mm:ss pasti konsisten
    // (gak gantung locale browser). Dikirim ke server supaya jam yang tersimpan
    // tetap jam SAAT SCAN, bukan jam saat request akhirnya diproses server --
    // penting kalau data ini sempat ketunda/disimpan offline dulu.
    function formatJamAksi() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // Ambil cadangan daftar kelas dari localStorage (dipakai saat offline / server gak terjangkau).
    function loadKelasListFromStorage(prefix) {
        try {
            const raw = localStorage.getItem(prefix + 'KelasListBackup');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return (Array.isArray(parsed) && parsed.length > 0) ? parsed : null;
        } catch (e) { return null; }
    }

    // Simpan kelas yang terakhir dipilih, biar kalau menu ini dibuka lagi (termasuk offline)
    // pilihan sebelumnya otomatis kepilih lagi -- gak balik ke "-- Pilih Kelas --" kosong.
    function saveLastKelasDipilih(prefix, kelas) {
        try {
            if (kelas) localStorage.setItem(prefix + 'LastKelasDipilih', kelas);
        } catch (e) {}
    }

    // Kembalikan (set value + trigger onchange) kelas terakhir yang dipilih, kalau ada di dropdown.
    function restoreLastKelasDipilih(sel, prefix) {
        try {
            const last = localStorage.getItem(prefix + 'LastKelasDipilih');
            if (!last) return;
            const found = Array.from(sel.options).some(o => o.value === last);
            if (!found) return;
            sel.value = last;
            sel.dispatchEvent(new Event('change'));
        } catch (e) {}
    }

    const OFFLINE_DB_NAME = 'waka_offline_queue';
    const OFFLINE_DB_STORE = 'queue';
    let offlineDbInstance = null;

    function openOfflineDb() {
        return new Promise((resolve, reject) => {
            if (offlineDbInstance) return resolve(offlineDbInstance);
            const req = indexedDB.open(OFFLINE_DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(OFFLINE_DB_STORE)) {
                    db.createObjectStore(OFFLINE_DB_STORE, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = () => { offlineDbInstance = req.result; resolve(offlineDbInstance); };
            req.onerror = () => reject(req.error);
        });
    }

    async function offlineDbAll() {
        const db = await openOfflineDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(OFFLINE_DB_STORE, 'readonly');
            const req = tx.objectStore(OFFLINE_DB_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function offlineDbAdd(item) {
        const db = await openOfflineDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
            const req = tx.objectStore(OFFLINE_DB_STORE).add(item);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function offlineDbDelete(id) {
        const db = await openOfflineDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
            const req = tx.objectStore(OFFLINE_DB_STORE).delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Dipanggil dari fitur (absen/sholat/pelanggaran) sebagai pengganti langsung
     * gas.run.xxx(...args). Kalau online -> coba kirim langsung; kalau
     * gagal/offline -> disimpan ke antrean lokal buat disinkron belakangan.
     *
     * jenisLabel : label buat ditampilkan di menu Sinkron Data, cth 'Absen Masuk'
     * fnName     : nama fungsi Apps Script di Code.gs yang dituju, cth 'scanPresensi'
     * args       : array argumen buat fungsi itu, urutannya harus sama persis
     * ketLabel   : teks singkat identitas data (nama siswa/kelas) buat ditampilkan di antrean
     *
     * mode       : 'direct-first' -> dipakai tap kartu & scan barcode. Langsung kirim ke
     *               server; masuk antrean lokal hanya kalau offline / antrean sudah
     *               menumpuk / kirim gagal (lalu dikirim lewat menu Sinkron Data).
     *               true -> (legacy) SELALU antrean lokal dulu, tidak pernah kirim langsung.
     *               kosong -> online: coba kirim langsung, gagal -> antrean.
     *
     * Return: Promise -> resolve({ viaServer:true, result }) kalau langsung terkirim,
     *         atau resolve({ viaServer:false, queued:true }) kalau disimpan ke antrean.
     */
    // Batas request langsung ke server yang boleh berjalan bersamaan (mode 'direct-first').
    // Kalau lebih dari ini (banyak siswa tap beruntun & server belum sempat membalas),
    // data berikutnya masuk antrean lokal supaya tidak menumpuk/berebut di server.
    const DIRECT_MAX_INFLIGHT = 3;
    let directInFlight = 0;

    function queueOfflineAction(jenisLabel, fnName, args, ketLabel, mode) {
        return new Promise((resolve) => {
            const enqueue = async () => {
                try {
                    await offlineDbAdd({ jenis: jenisLabel, fnName, args, ketLabel: ketLabel || '', waktu: new Date().toISOString() });
                } catch (e) { /* IndexedDB gagal -> tetap kabari pemanggil */ }
                refreshSinkronBadge();
                resolve({ viaServer: false, queued: true });
            };
            const sendDirect = (onFail) => {
                directInFlight++;
                gas.run
                    .withSuccessHandler(result => { directInFlight--; resolve({ viaServer: true, result }); })
                    .withFailureHandler(() => { directInFlight--; onFail(); })
                    [fnName](...args);
            };

            // MODE 'direct-first' (tap kartu & scan barcode):
            //   langsung kirim ke server (spreadsheet). Masuk antrean lokal HANYA kalau:
            //   - perangkat offline, atau
            //   - sudah ada antrean tertunda (data baru harus antre di belakangnya supaya
            //     urutannya benar, misal "pulang" tidak mendahului "masuk"), atau
            //   - request langsung yang sedang berjalan sudah menumpuk, atau
            //   - kirim langsung gagal (server error/timeout).
            if (mode === 'direct-first') {
                if (!navigator.onLine || directInFlight >= DIRECT_MAX_INFLIGHT) { enqueue(); return; }
                offlineDbAll()
                    .then(pending => {
                        if (pending.length > 0) enqueue();
                        else sendDirect(enqueue);
                    })
                    .catch(() => sendDirect(enqueue));
                return;
            }

            // mode true (legacy) -> SELALU antrean lokal dulu, tidak pernah kirim langsung.
            // mode kosong       -> kalau online coba kirim langsung, gagal -> antrean.
            const trySendDirectly = navigator.onLine && !mode;
            if (trySendDirectly) sendDirect(enqueue);
            else enqueue();
        });
    }

    async function refreshSinkronBadge() {
        try {
            const items = await offlineDbAll();
            const countEl = document.getElementById('sinkronQueueCount');
            if (countEl) countEl.textContent = items.length;

            // Sertakan jumlah antrean di badge header (selalu terlihat)
            const headerBadge = document.getElementById('headerConnStatus');
            if (headerBadge) {
                const label = headerBadge.querySelector('span:last-child');
                if (label) {
                    const base = navigator.onLine ? 'Online' : 'Offline';
                    label.textContent = items.length > 0 ? `${base} · ${items.length} antre` : base;
                }
            }

            // Badge kecil di menu sidebar (kalau ada elemennya)
            const menuLink = document.querySelector('#sidebarMenu a[data-name="Sinkron Data"]');
            if (menuLink) {
                let dot = menuLink.querySelector('.sinkron-dot');
                if (items.length > 0) {
                    if (!dot) {
                        dot = document.createElement('span');
                        dot.className = 'sinkron-dot ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5';
                        menuLink.appendChild(dot);
                    }
                    dot.textContent = items.length;
                } else if (dot) {
                    dot.remove();
                }
            }
        } catch (e) { /* IndexedDB belum siap / browser gak dukung -> diamkan */ }
    }

    function renderSinkronStatusBadge() {
        const online = navigator.onLine;

        const badge = document.getElementById('sinkronStatusBadge');
        if (badge) {
            badge.className = 'text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 ' +
                (online ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500');
            badge.querySelector('span:first-child').className = 'w-2 h-2 rounded-full ' + (online ? 'bg-emerald-500' : 'bg-red-500');
            badge.querySelector('span:last-child').textContent = online ? 'Online' : 'Offline';
        }

        // Badge di header, selalu tampil di semua halaman
        const headerBadge = document.getElementById('headerConnStatus');
        if (headerBadge) {
            headerBadge.className = 'flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition ' +
                (online ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100' : 'bg-red-50 text-red-500 border-red-100 hover:bg-red-100 animate-pulse');
            headerBadge.querySelector('span:first-child').className = 'w-2 h-2 rounded-full ' + (online ? 'bg-emerald-500' : 'bg-red-500');
            headerBadge.querySelector('span:last-child').textContent = online ? 'Online' : 'Offline';
        }
    }

    async function renderSinkronQueueList() {
        const listEl = document.getElementById('sinkronQueueList');
        if (!listEl) return;
        const items = await offlineDbAll();
        if (items.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400 text-center py-8">Tidak ada data yang mengantre.</p>`;
            return;
        }
        listEl.innerHTML = items.map(it => `
            <div class="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2.5">
                <div>
                    <p class="text-sm font-semibold text-gray-700">${it.jenis}${it.ketLabel ? ' — ' + it.ketLabel : ''}</p>
                    <p class="text-[11px] text-gray-400">${new Date(it.waktu).toLocaleString('id-ID')}</p>
                </div>
                <span class="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">Menunggu</span>
            </div>
        `).join('');
    }

    async function loadSinkronData() {
        showView('view-sinkron-data');
        setActiveMenu('Sinkron Data');
        renderSinkronStatusBadge();
        await refreshSinkronBadge();
        await renderSinkronQueueList();
        renderDownloadSiswaLastInfo();
    }

    function renderDownloadSiswaLastInfo() {
        const el = document.getElementById('downloadSiswaLastInfo');
        if (!el) return;
        try {
            const waktu = localStorage.getItem('downloadSiswaTerakhir');
            const jumlah = localStorage.getItem('downloadSiswaJumlah');
            if (waktu) {
                el.textContent = `Terakhir diunduh: ${new Date(waktu).toLocaleString('id-ID')}` + (jumlah ? ` (${jumlah} siswa)` : '');
            } else {
                el.textContent = 'Belum pernah diunduh di perangkat ini.';
            }
        } catch (e) {}
    }

    /**
     * Unduh SEMUA data siswa + kelas dari server, simpan ke localStorage dengan
     * format yang sama persis dengan yang dipakai getSiswaByKelasCached (Absen
     * Masuk/Pulang) dan cache siswa-per-kelas di Presensi Sholat -- supaya
     * begitu perangkat offline, membuka kelas manapun di kedua fitur tersebut
     * tetap langsung muat data siswanya dari cache ini.
     */
    function downloadDataSiswaOffline() {
        if (!navigator.onLine) {
            showAlert('error', 'Harus online buat download data siswa. Sambungkan internet dulu.');
            return;
        }

        const btn = document.getElementById('downloadSiswaBtn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Mengunduh...'; }

        gas.run
            .withSuccessHandler(res => {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download Sekarang'; }
                if (!res.success) {
                    showAlert('error', res.message || 'Gagal mengunduh data.');
                    return;
                }

                const kelasList = res.kelasList || [];
                const siswaList = res.siswaList || [];

                try {
                    // 1) Daftar kelas -- dipakai dropdown kelas Absen & Sholat pas offline
                    localStorage.setItem('dhKelasListBackup', JSON.stringify(kelasList));
                    localStorage.setItem('sholatKelasListBackup', JSON.stringify(kelasList));

                    // 2) Siswa per kelas -- format Absen Masuk/Pulang (array polos: nama, nis, kelas)
                    const grupByKelas = {};
                    siswaList.forEach(s => {
                        const k = s.kelas || '';
                        if (!grupByKelas[k]) grupByKelas[k] = [];
                        grupByKelas[k].push({ nama: s.nama, nis: s.nis, kelas: s.kelas });
                    });
                    Object.keys(grupByKelas).forEach(k => {
                        localStorage.setItem('dhSiswaByKelas:' + k, JSON.stringify(grupByKelas[k]));
                        localStorage.setItem('sholatSiswaByKelas:' + k, JSON.stringify({ success: true, data: grupByKelas[k] }));
                    });

                    // 3) Opsi "Semua Kelas" (SEMUA) -- dipakai admin/guru wali semua kelas
                    const semuaSiswa = siswaList.map(s => ({ nama: s.nama, nis: s.nis, kelas: s.kelas }));
                    localStorage.setItem('dhSiswaByKelas:SEMUA', JSON.stringify(semuaSiswa));
                    localStorage.setItem('sholatSiswaByKelas:SEMUA', JSON.stringify({ success: true, data: semuaSiswa }));

                    // 4) Cache lama punya "Scan Presensi" (siswaLocalCache) -- sekalian diisi juga
                    const siswaLocalCacheBackup = {};
                    siswaList.forEach(s => { siswaLocalCacheBackup[s.nis] = { nama: s.nama, kelas: s.kelas }; });
                    localStorage.setItem('siswaLocalCacheBackup', JSON.stringify(siswaLocalCacheBackup));

                    localStorage.setItem('downloadSiswaTerakhir', new Date().toISOString());
                    localStorage.setItem('downloadSiswaJumlah', String(siswaList.length));
                } catch (e) {
                    showAlert('error', 'Gagal menyimpan ke perangkat: ' + e.message);
                    return;
                }

                renderDownloadSiswaLastInfo();
                showAlert('success', `${siswaList.length} siswa & ${kelasList.length} kelas berhasil disimpan ke perangkat untuk mode offline.`);
            })
            .withFailureHandler(err => {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Download Sekarang'; }
                showAlert('error', 'Gagal konek server: ' + err);
            })
            .getDataOfflineDownload();
    }

    /**
     * Kirim semua item di antrean ke server satu-satu (sengaja sequential, bukan
     * paralel, biar gak numpuk lock server kalau ada banyak antrean sekaligus).
     */
    async function syncOfflineQueue() {
        if (!navigator.onLine) {
            showAlert('error', 'Perangkat masih offline. Sambungkan internet dulu sebelum sinkron.');
            return;
        }
        const items = await offlineDbAll();
        if (items.length === 0) {
            showAlert('success', 'Tidak ada data yang perlu disinkron.');
            return;
        }

        const btn = document.getElementById('sinkronBtn');
        const progressBox = document.getElementById('sinkronProgressBox');
        const progressBar = document.getElementById('sinkronProgressBar');
        const progressPct = document.getElementById('sinkronProgressPercent');
        const progressDetail = document.getElementById('sinkronProgressDetail');
        if (btn) { btn.disabled = true; btn.classList.add('opacity-50'); }
        if (progressBox) progressBox.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (progressPct) progressPct.textContent = '0%';

        let berhasil = 0, gagal = 0;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const pct = Math.round(((i) / items.length) * 100);
            if (progressBar) progressBar.style.width = pct + '%';
            if (progressPct) progressPct.textContent = pct + '%';
            if (progressDetail) progressDetail.textContent = `(${i + 1}/${items.length}) ${it.jenis}${it.ketLabel ? ' — ' + it.ketLabel : ''}`;
            try {
                await new Promise((resolve, reject) => {
                    gas.run
                        .withSuccessHandler(res => (res && res.success === false) ? reject(res.message || 'Gagal') : resolve(res))
                        .withFailureHandler(err => reject(err))
                        [it.fnName](...it.args);
                });
                await offlineDbDelete(it.id);
                berhasil++;
            } catch (e) {
                gagal++; // tetap di antrean, dicoba lagi lain kali
            }
            const pctDone = Math.round(((i + 1) / items.length) * 100);
            if (progressBar) progressBar.style.width = pctDone + '%';
            if (progressPct) progressPct.textContent = pctDone + '%';
        }

        if (progressDetail) progressDetail.textContent = 'Selesai!';
        if (progressBar) { progressBar.classList.remove('from-orange-400', 'via-orange-500', 'to-red-500'); progressBar.classList.add('from-emerald-400', 'via-emerald-500', 'to-emerald-600'); }
        await new Promise(r => setTimeout(r, 500));

        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50'); }
        if (progressBox) progressBox.classList.add('hidden');
        if (progressBar) { progressBar.classList.add('from-orange-400', 'via-orange-500', 'to-red-500'); progressBar.classList.remove('from-emerald-400', 'via-emerald-500', 'to-emerald-600'); }

        await refreshSinkronBadge();
        await renderSinkronQueueList();

        if (gagal === 0) {
            showAlert('success', `${berhasil} data berhasil disinkron ke server.`);
        } else {
            showAlert('error', `${berhasil} berhasil, ${gagal} gagal (tetap di antrean, coba sinkron lagi nanti).`);
        }
    }

    /**
     * Hapus SELURUH antrean lokal (tombol "Hapus Antrean" -> onclick="clearSinkronQueue()").
     * Data yang dihapus tidak dikirim ke server dan tidak bisa dipulihkan.
     */
    async function clearSinkronQueue() {
        try {
            const items = await offlineDbAll();
            const count = items.length;
            if (count === 0) {
                showAlert('success', 'Antrean sudah kosong.');
                return;
            }
            if (!confirm(`Hapus ${count} item antrean secara permanen?\n\nData yang dihapus TIDAK dapat dipulihkan dan TIDAK akan terkirim ke server.`)) return;

            const db = await openOfflineDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
                tx.objectStore(OFFLINE_DB_STORE).clear();
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('Transaksi dibatalkan'));
            });

            await refreshSinkronBadge();
            await renderSinkronQueueList();
            showAlert('success', `${count} item antrean berhasil dihapus.`);
        } catch (e) {
            showAlert('error', 'Gagal menghapus antrean: ' + (e && e.message ? e.message : e));
        }
    }
    // Alias nama lama
    function hapusSemuaAntrean() { return clearSinkronQueue(); }

    /**
     * Ubah 1 item antrean offline (bentuknya beda-beda tergantung fnName) jadi
     * baris-baris rapi buat diekspor. 1 item bisa jadi >1 baris kalau isinya
     * batch (banyak siswa sekaligus, misal submitDaftarHadirGuru/submitPresensiSholat).
     */
    function queueItemToRows(item) {
        const args = item.args || [];
        const dicatat = item.waktu ? new Date(item.waktu).toLocaleString('id-ID') : '';
        const base = { Jenis: item.jenis || item.fnName, 'Dicatat di Perangkat': dicatat };
        const rows = [];

        switch (item.fnName) {
            case 'scanPresensi': {
                const [nis, , kelas, jamAksiISO] = args;
                const jamTampil = jamAksiISO ? new Date(jamAksiISO).toLocaleString('id-ID') : '';
                rows.push({ ...base, NIS: nis, Nama: (item.ketLabel || '').replace(/\s*\(.*\)$/, ''), Kelas: kelas, 'Jam/Ket': jamTampil });
                break;
            }
            case 'batchScanPresensi': {
                const [nisList, , kelas, jamAksiISO] = args;
                const jamTampil = jamAksiISO ? new Date(jamAksiISO).toLocaleString('id-ID') : '';
                (nisList || []).forEach(nis => {
                    rows.push({ ...base, NIS: nis, Nama: '', Kelas: kelas, 'Jam/Ket': jamTampil });
                });
                break;
            }
            case 'submitDaftarHadirGuru': {
                const [dataList, tanggal] = args;
                (dataList || []).forEach(s => {
                    rows.push({ ...base, NIS: s.nis, Nama: s.nama, Kelas: s.kelas, Tanggal: tanggal, 'Jam/Ket': s.jamAksi || '', Status: s.status });
                });
                break;
            }
            case 'submitPulangGuru': {
                const [pulangList, tanggal] = args;
                (pulangList || []).forEach(p => {
                    rows.push({ ...base, NIS: p.nis, Tanggal: tanggal, 'Jam/Ket': p.jamAksi || '', Status: 'Pulang' });
                });
                break;
            }
            case 'submitPulangSatu': {
                const [nis, kelas, tanggal, , jamAksi] = args;
                rows.push({ ...base, NIS: nis, Nama: (item.ketLabel || '').replace(/\s*\(.*\)$/, ''), Kelas: kelas, Tanggal: tanggal, 'Jam/Ket': jamAksi || '', Status: 'Pulang' });
                break;
            }
            case 'submitPresensiSholat': {
                const [dataList, tanggal, waktuSholat] = args;
                (dataList || []).forEach(s => {
                    rows.push({ ...base, NIS: s.nis, Nama: s.nama, Kelas: s.kelas, Tanggal: tanggal, 'Jam/Ket': `${waktuSholat || ''} ${s.jamAksi || ''}`.trim(), Status: s.status, Keterangan: s.keterangan || '' });
                });
                break;
            }
            case 'addPelanggaran': {
                const [, data] = args;
                rows.push({ ...base, NIS: data.nis, Nama: data.nama, Kelas: data.kelas, Tanggal: data.tanggal, 'Jam/Ket': data.kodePelanggaran, Status: data.jenisPelanggaran, Keterangan: 'Poin: ' + data.point });
                break;
            }
            default: {
                rows.push({ ...base, Nama: item.ketLabel || '', 'Jam/Ket': '', Keterangan: '' });
            }
        }
        return rows;
    }

    /**
     * Unduh seluruh antrean lokal (belum disinkron) sebagai CSV atau Excel.
     * Data TIDAK dihapus dari antrean -- ini cuma salinan buat dicek/dicetak manual,
     * antrean asli tetap utuh sampai user klik Sinkron Sekarang.
     */
    async function exportSinkronQueue(format) {
        const items = await offlineDbAll();
        if (items.length === 0) {
            showAlert('error', 'Tidak ada data yang mengantre untuk diunduh.');
            return;
        }

        const kolom = ['No', 'Jenis', 'NIS', 'Nama', 'Kelas', 'Tanggal', 'Jam/Ket', 'Status', 'Keterangan', 'Dicatat di Perangkat'];
        let rows = [];
        items.forEach(it => { rows = rows.concat(queueItemToRows(it)); });
        rows.forEach((r, i) => { r['No'] = i + 1; });

        const namaFile = 'Antrean_Belum_Sinkron_' + new Date().toISOString().slice(0, 10);

        if (format === 'csv') {
            const escapeCsv = v => {
                const s = (v === undefined || v === null) ? '' : String(v);
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            };
            const lines = [kolom.join(',')];
            rows.forEach(r => lines.push(kolom.map(k => escapeCsv(r[k])).join(',')));
            const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = namaFile + '.csv';
            a.click();
            URL.revokeObjectURL(a.href);
        } else {
            const ws = XLSX.utils.json_to_sheet(rows, { header: kolom });
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Antrean');
            XLSX.writeFile(wb, namaFile + '.xlsx');
        }

        showAlert('success', `${rows.length} baris data berhasil diunduh (${format.toUpperCase()}). Data di antrean tetap tersimpan, belum terkirim ke server.`);
    }

    // Auto-refresh badge status online/offline. SENGAJA tidak auto-sync begitu
    // koneksi balik -- semua data di antrean (termasuk hasil scan/tap presensi
    // masuk-pulang & sholat) cuma boleh terkirim ke server lewat klik tombol
    // Sinkron di menu "Sinkron Data", biar user yang kontrol kapan data keluar.
    window.addEventListener('online', () => { renderSinkronStatusBadge(); });
    window.addEventListener('offline', () => { renderSinkronStatusBadge(); });
    // Update badge antrean begitu app pertama kali dimuat
    setTimeout(() => { renderSinkronStatusBadge(); refreshSinkronBadge(); }, 800);

    // ==========================================================================
    // TEMA TERANG / GELAP
    // Pilihan disimpan di localStorage, diterapkan lewat atribut data-theme di
    // <html>. Aksen orange/merah tetap sama di kedua tema (diatur di
    // Stylesheet.html) -- yang berubah cuma warna latar/teks/border.
    // ==========================================================================
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const icon = document.getElementById('themeToggleIcon');
        if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        try { localStorage.setItem('appTheme', theme); } catch (e) {}
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }

    // Terapkan tema tersimpan begitu script dimuat (sebelum konten lain dirender)
    (function initTheme() {
        let saved = 'light';
        try { saved = localStorage.getItem('appTheme') || 'light'; } catch (e) {}
        document.documentElement.setAttribute('data-theme', saved);
        const icon = document.getElementById('themeToggleIcon');
        if (icon) icon.className = saved === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    })();

    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const main = document.getElementById('mainContent');
        const overlay = document.getElementById('mobileOverlay');
        const labels = document.querySelectorAll('.sidebar-label');
        const header = document.getElementById('sidebarHeader');
        const userCard = document.getElementById('userProfileCard');
        const logoutBtn = document.getElementById('btnLogout');
        const menuLinks = document.querySelectorAll('#sidebarMenu a');

        const isMobile = window.innerWidth < 768;

        if (isMobile) {
            if (sidebar.classList.contains('-translate-x-full')) {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
                setTimeout(() => overlay.classList.remove('opacity-0'), 10);
            } else {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('opacity-0');
                setTimeout(() => overlay.classList.add('hidden'), 300);
            }
        } else {
            if (isSidebarOpen) {
                // COLLAPSE
                sidebar.classList.remove('w-64');
                sidebar.classList.add('w-20');
                main.classList.remove('md:ml-64');
                main.classList.add('md:ml-20');

                // Centering items
                header.classList.remove('px-6', 'justify-start'); header.classList.add('px-0', 'justify-center');
                userCard.classList.remove('space-x-3', 'p-3', 'bg-black/20', 'border'); userCard.classList.add('justify-center', 'p-0', 'bg-transparent', 'border-transparent');
                logoutBtn.classList.remove('space-x-3', 'justify-start', 'px-4'); logoutBtn.classList.add('justify-center', 'px-0');
                menuLinks.forEach(link => { link.classList.remove('space-x-3', 'px-4'); link.classList.add('justify-center', 'px-0'); });
                labels.forEach(el => { el.classList.add('hidden'); });

                isSidebarOpen = false;
            } else {
                // EXPAND
                sidebar.classList.remove('w-20');
                sidebar.classList.add('w-64');
                main.classList.remove('md:ml-20');
                main.classList.add('md:ml-64');

                // Reset items
                header.classList.add('px-6', 'justify-start'); header.classList.remove('px-0', 'justify-center');
                userCard.classList.add('space-x-3', 'p-3', 'bg-black/20', 'border'); userCard.classList.remove('justify-center', 'p-0', 'bg-transparent', 'border-transparent');
                logoutBtn.classList.add('space-x-3', 'justify-start', 'px-4'); logoutBtn.classList.remove('justify-center', 'px-0');
                menuLinks.forEach(link => { link.classList.add('space-x-3', 'px-4'); link.classList.remove('justify-center', 'px-0'); });
                labels.forEach(el => { el.classList.remove('hidden'); });

                isSidebarOpen = true;
            }
        }
    }

    function closeSidebarMobile() {
        if (window.innerWidth < 768) {
            document.getElementById('sidebar').classList.add('-translate-x-full');
            const overlay = document.getElementById('mobileOverlay');
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.classList.add('hidden'), 300);
        }
    }

    // ==========================================================================
    // 4. AUTENTIKASI
    // ==========================================================================
    function switchLoginTab(tab) {
        document.getElementById('loginError').classList.add('hidden');
        const btnSiswa = document.getElementById('btnSiswaTab');
        const btnAdmin = document.getElementById('btnAdminTab');
        
        const activeClass = "bg-white text-indigo-600 shadow-sm";
        const inactiveClass = "text-gray-500 hover:text-gray-700 hover:bg-gray-200";

        btnSiswa.className = `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${tab === 'siswa' ? activeClass : inactiveClass}`;
        btnAdmin.className = `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${tab === 'admin' ? activeClass : inactiveClass}`;

        if (tab === 'admin') {
            document.getElementById('formAdminLogin').classList.remove('hidden');
            document.getElementById('formSiswaLogin').classList.add('hidden');
        } else {
            document.getElementById('formAdminLogin').classList.add('hidden');
            document.getElementById('formSiswaLogin').classList.remove('hidden');
        }
    }

    /**
     * Pintu masuk tersembunyi lewat box "Nominal Donasi" di modal Donasi.
     * PIN dicek di SERVER lewat loginNominal() -- gak ada angka rahasia yang
     * ketinggalan di source code JS ini. Salah PIN -> diam, gak ada respon apapun.
     */
    function cekAksesNominal(value) {
        const pin = String(value).trim();
        if (!pin) return;

        gas.run
            .withSuccessHandler(result => {
                if (!result || !result.success) return; // salah -> diam total
                currentUser = result;
                localStorage.setItem('presensiAppSession', JSON.stringify(result));
                document.getElementById('donasiModal').classList.add('hidden');
                document.getElementById('loginPage').classList.add('hidden');
                document.getElementById('dashboardContainer').classList.remove('hidden');
                initDashboard();
            })
            .withFailureHandler(() => {}) // gagal konek -> tetap diam, jangan bocorin apapun
            .loginNominal(pin);
    }

    function handleLogin(event) {
        event.preventDefault();
        showLoading();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const nis = document.getElementById('nis').value;

        gas.run
            .withSuccessHandler(onLoginSuccess)
            .withFailureHandler(onLoginFailure)
            .login(username, password, nis);
    }

    function onLoginSuccess(result) {
        hideLoading(); // Sembunyikan animasi loading
        
        if (result.success) {
            // 1. Simpan data user + TOKEN ke variabel global
            currentUser = result; 
            
            // 2. Simpan ke LocalStorage agar token bertahan saat refresh page
            localStorage.setItem('presensiAppSession', JSON.stringify(result));
            
            // 3. Update UI: Sembunyikan Login, Tampilkan Dashboard
            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('dashboardContainer').classList.remove('hidden');
            
            // 4. Inisialisasi Dashboard
            initDashboard();
        } else {
            // Tampilkan pesan error jika login gagal
            const errorDiv = document.getElementById('loginError');
            document.getElementById('errorText').textContent = result.message;
            errorDiv.classList.remove('hidden');
            setTimeout(() => errorDiv.classList.add('hidden'), 5000);
        }
    }

    function onLoginFailure(error) {
        hideLoading();
        alert('Gagal terhubung ke server: ' + error.message);
    }

    function logout() {
        stopAndBack(false);
        localStorage.removeItem('presensiAppSession');
        currentUser = null;
        appCache = { siswa: null, guru: null };
        document.getElementById('dashboardContainer').classList.add('hidden');
        document.getElementById('loginPage').classList.remove('hidden');
        
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('nis').value = '';
        document.getElementById('sidebar').classList.add('-translate-x-full');
    }

    // ==========================================================================
    // 5. DASHBOARD & MENU
    // ==========================================================================
function initDashboard() {
    const name = currentUser.nama || currentUser.username;
    document.getElementById('navUserName').textContent = name;
    
    // Tampilkan Role dengan format yang rapi
    let displayRole = currentUser.role.toUpperCase();
    if (currentUser.role === 'waka') displayRole = 'WAKIL KEPALA SEKOLAH';
    document.getElementById('navUserRole').textContent = displayRole;
    
    document.getElementById('navUserInitial').textContent = name.charAt(0).toUpperCase();

    const menuContainer = document.getElementById('sidebarMenu');
    let menuHTML = '';

    // Helper untuk membuat HTML menu item
    const createItem = (label, icon, onclick, isDefaultActive = false) => {
        const hideText = !isSidebarOpen ? 'hidden' : ''; 
        const centerClass = !isSidebarOpen ? 'justify-center px-0' : 'space-x-3 px-4';
        const baseStyle = `flex items-center ${centerClass} py-3 rounded-xl transition-all duration-200 group overflow-hidden whitespace-nowrap cursor-pointer `;
        const activeStyle = "bg-orange-600 text-white shadow-lg shadow-orange-900/50";
        const inactiveStyle = "text-gray-400 hover:bg-gray-800 hover:text-white";
        const currentStyle = isDefaultActive ? (baseStyle + activeStyle) : (baseStyle + inactiveStyle);

        return `
        <a data-name="${label}" onclick="${onclick}" class="${currentStyle}">
            <i class="fas ${icon} w-6 text-center flex-shrink-0 group-hover:scale-110 transition-transform"></i>
            <span class="sidebar-label font-medium transition-opacity duration-300 ${hideText}">${label}</span>
        </a>`;
    };

    // --- MENU UNTUK ADMIN ---
    if (currentUser.role === 'admin') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadAdminDashboard()', true);
        menuHTML += createItem('Data Siswa', 'fa-user-graduate', 'loadDataSiswa()');
        menuHTML += createItem('Data Guru', 'fa-chalkboard-teacher', 'loadDataGuru()');
        menuHTML += createItem('Laporan', 'fa-clipboard-list', 'loadRekapPresensi()');
        menuHTML += createItem('Rekap Bulanan', 'fa-calendar-alt', 'loadMenuRekapBulanan()');
        menuHTML += createItem('Kenaikan Kelas', 'fa-level-up-alt', 'loadKenaikanKelas()');
        menuHTML += createItem('Kelola Absen', 'fa-calendar-times', 'loadKelolaAbsen()');
        menuHTML += createItem('Manajemen Kelas', 'fa-th-large', 'loadManajemenKelas()'); 
        menuHTML += createItem('Manajemen Pelanggaran', 'fa-exclamation-circle', 'loadManajemenPelanggaran()');
        menuHTML += createItem('Input Pelanggaran', 'fa-exclamation-triangle', 'loadPelanggaran()');
        menuHTML += createItem('Daftar Hadir', 'fa-clipboard-check', 'loadDaftarHadirGuru()');
        menuHTML += createItem('Presensi Sholat', 'fa-mosque', 'loadPresensiSholat()');
        
        loadAdminDashboard();
    } 
    // --- MENU UNTUK GURU ---
    else if (currentUser.role === 'guru') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadGuruDashboard()', true);
        menuHTML += createItem('Daftar Hadir', 'fa-clipboard-check', 'loadDaftarHadirGuru()');
        menuHTML += createItem('Presensi Sholat', 'fa-mosque', 'loadPresensiSholat()');
        menuHTML += createItem('Input Pelanggaran', 'fa-exclamation-triangle', 'loadPelanggaran()');
        menuHTML += createItem('Monitoring Pelanggaran', 'fa-user-shield', 'loadMonitoringPelanggaran()');
        menuHTML += createItem('Monitoring', 'fa-eye', 'loadMonitoringPresensi()');
        menuHTML += createItem('Rekap Bulanan', 'fa-calendar-alt', 'loadMenuRekapBulanan()');
        menuHTML += createItem('Sinkron Data', 'fa-sync-alt', 'loadSinkronData()');
        loadGuruDashboard();
    } 
    // --- MENU UNTUK WAKIL KEPALA SEKOLAH (BARU) ---
    else if (currentUser.role === 'waka') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadAdminDashboard()', true);
        menuHTML += createItem('Laporan', 'fa-clipboard-list', 'loadRekapPresensi()');
        menuHTML += createItem('Rekap Bulanan', 'fa-calendar-alt', 'loadMenuRekapBulanan()');
        loadAdminDashboard();
    }
    // --- MENU UNTUK SISWA ---
    else if (currentUser.role === 'siswa') {
        menuHTML += createItem('Dashboard', 'fa-home', 'loadSiswaDashboard()', true);
        menuHTML += createItem('Profil Saya', 'fa-id-card', 'loadProfilSiswa()');
        menuHTML += createItem('Rekap Kehadiran', 'fa-chart-pie', 'loadRekapKehadiranSiswa()');
        loadSiswaDashboard();
    }
    // --- MENU UNTUK NOMINAL (akses tersembunyi lewat box Donasi) ---
    else if (currentUser.role === 'nominal') {
        menuHTML += createItem('Daftar Hadir', 'fa-clipboard-check', 'loadDaftarHadirGuru()', true);
        menuHTML += createItem('Presensi Sholat', 'fa-mosque', 'loadPresensiSholat()');
        menuHTML += createItem('Sinkron Data', 'fa-sync-alt', 'loadSinkronData()');
        loadDaftarHadirGuru();
    }

    // Render Menu ke HTML
    menuContainer.innerHTML = menuHTML;
    
    // --- AMBIL DATA KELAS (Untuk Autocomplete/Dropdown) ---
    loadKelasSuggestions();
}
    
    // --- DROPDOWN KELAS LOGIC ---
    function loadKelasSuggestions() {
        console.log("Memuat daftar kelas dari Konfigurasi...");
        
        gas.run.withSuccessHandler(function(classes) {
            existingClasses = classes; // Simpan ke variabel global
            
            // Populate semua dropdown yang ada di HTML saat ini
            populateAllClassDropdowns();
            
        }).getDaftarKelas(); // Memanggil fungsi backend yang baru kita ubah
    }

function populateAllClassDropdowns() {
    const dropdownIds = [
        'filterKelas',      // Di Data Siswa
        'filterKelasGuru',  // Di Data Guru (jika ada)
        'rekapKelas',       // Di Rekap Bulanan
        'promoKelasAsal',   // Di Kenaikan Kelas
        'promoKelasTujuan'  // Di Kenaikan Kelas
    ];

    dropdownIds.forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            // Simpan value yang sedang dipilih (jika ada) biar tidak ke-reset total
            const currentValue = select.value;
            
            // Simpan opsi default/pertama (biasanya "-- Pilih Kelas --" atau "Semua Kelas")
            const defaultOption = select.options[0] ? select.options[0].cloneNode(true) : null;
            
            // Opsional khusus: Untuk Promo Tujuan ada opsi LULUS
            let extraOption = null;
            if(id === 'promoKelasTujuan') {
               extraOption = select.querySelector('option[value="LULUS"]');
            }

            // Kosongkan dropdown
            select.innerHTML = '';
            
            // Kembalikan opsi default
            if (defaultOption) select.appendChild(defaultOption);
            if (extraOption) select.appendChild(extraOption.cloneNode(true));

            // Isi dengan data dari Konfigurasi
            existingClasses.forEach(kelas => {
                const option = document.createElement('option');
                option.value = kelas;
                option.text = kelas;
                select.appendChild(option);
            });

            // Restore value jika masih valid
            if (existingClasses.includes(currentValue)) {
                select.value = currentValue;
            }
        }
    });
}
    function openKelasDropdown() {
        const input = document.getElementById('inputKelas');
        const dropdown = document.getElementById('dropdownKelasList');
        if (!dropdown) return;
        renderKelasDropdown(existingClasses);
        dropdown.classList.remove('hidden');
    }

    function filterKelasDropdown(keyword) {
        const filtered = existingClasses.filter(c => c.toLowerCase().includes(keyword.toLowerCase()));
        renderKelasDropdown(filtered);
    }

    function renderKelasDropdown(items) {
        const dropdown = document.getElementById('dropdownKelasList');
        if (!items || items.length === 0) {
            dropdown.innerHTML = '<div class="px-4 py-3 text-xs text-gray-400 italic">Kelas tidak ditemukan. Ketik untuk membuat baru.</div>';
            return;
        }
        dropdown.innerHTML = items.map(kelas => `
            <div onclick="selectKelas('${kelas}')" class="px-4 py-2 hover:bg-indigo-50 cursor-pointer text-sm text-gray-700 transition-colors border-b border-gray-50 last:border-none">
                ${kelas}
            </div>
        `).join('');
    }

    function selectKelas(value) {
        const input = document.getElementById('inputKelas');
        if (input) {
            input.value = value;
            closeKelasDropdown();
        }
    }

    function closeKelasDropdown() {
        const dropdown = document.getElementById('dropdownKelasList');
        if (dropdown) {
            setTimeout(() => dropdown.classList.add('hidden'), 200);
        }
    }

    // ==========================================================================
    // 6. FUNGSI REFRESH DATA
    // ==========================================================================
function refreshData(type) {
        const btnIcon = event ? event.currentTarget.querySelector('i') : null;
        if(btnIcon) btnIcon.classList.add('fa-spin');

        if (type === 'siswa') {
            tableState.siswa.fullData = []; // Clear cache
            loadDataSiswa();       
            showAlert('success', 'Data siswa diperbarui.');
        } 
        else if (type === 'guru') {
             tableState.guru.fullData = []; // Clear cache
            loadDataGuru();        
            showAlert('success', 'Data guru diperbarui.');
        }
        else if (type === 'dashboard') {
            if (currentUser.role === 'admin') loadAdminDashboard();
            else if (currentUser.role === 'guru') loadGuruDashboard();
            else loadSiswaDashboard();
            showAlert('success', 'Statistik Dashboard diperbarui.');
        }

        else if (type === 'monitoring') {
            tableState.monitoring.fullData = [];
            // Pertahankan classFilter & statusFilter agar dropdown tidak reset
            loadMonitoringPresensi(); 
            showAlert('success', 'Data monitoring diperbarui.');
        }

        if(btnIcon) setTimeout(() => btnIcon.classList.remove('fa-spin'), 1000);
    }

    // ==========================================================================
    // 7. HALAMAN & LOGIKA DATA
    // ==========================================================================
    
    // --- ADMIN DASHBOARD ---
function loadAdminDashboard() {
    stopAndBack(false);
    setActiveMenu('Dashboard');
    showView('view-admin-dashboard');
    
    // Update Tanggal Header
    document.getElementById('adminDateDisplay').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // --- LOGIKA KHUSUS WAKIL KEPALA SEKOLAH ---
    const quickAccessPanel = document.getElementById('adminQuickAccess');
    const dashboardTitle = document.querySelector('#view-admin-dashboard h2');
    const wakaTopPagiPanel = document.getElementById('wakaTopPagiPanel');

    if (currentUser.role === 'waka') {
        // Sembunyikan Akses Cepat (Scan, Data Siswa, dll)
        if(quickAccessPanel) quickAccessPanel.style.display = 'none';
        if(dashboardTitle) dashboardTitle.textContent = 'Dashboard Wakil Kepala Sekolah';
        if(wakaTopPagiPanel) { wakaTopPagiPanel.classList.remove('hidden'); }
        loadWakaTopPagi();
    } else {
        // Tampilkan untuk Admin
        if(quickAccessPanel) quickAccessPanel.style.display = 'block';
        if(dashboardTitle) dashboardTitle.textContent = 'Dashboard Admin';
        if(wakaTopPagiPanel) { wakaTopPagiPanel.classList.add('hidden'); }
    }
    // -------------------------------------------

    // Gunakan getMonitoringRealtime agar data konsisten dengan monitoring
    gas.run.withSuccessHandler(result => {
        if (result.success) {
            const data = result.data;
            
            // 1. Hitung Statistik Global
            const total = data.length;
            const hadir = data.filter(d => d.status === 'Hadir').length;
            const sakit = data.filter(d => d.status === 'Sakit').length;
            const izin = data.filter(d => d.status === 'Izin').length;
            const alpa = data.filter(d => d.status === 'Alpa').length;
            const belum = data.filter(d => d.status === 'Belum Absen').length;

            // 2. Update Small Boxes (Animasi)
            animateValue("admStatTotal", 0, total, 800);
            animateValue("admStatHadir", 0, hadir, 800);
            animateValue("admStatSakit", 0, sakit, 800);
            animateValue("admStatIzin", 0, izin, 800);
            animateValue("admStatAlpa", 0, alpa, 800);

            // 3. Render Chart
            renderAdminChart(hadir, sakit, izin, alpa, belum);
        }
    }).getMonitoringRealtime();
}

    function renderAdminChart(hadir, sakit, izin, alpa, belum) {
        const ctx = document.getElementById('adminAttendanceChart');
        if (!ctx) return;

        if (adminChartInstance) {
            adminChartInstance.destroy();
        }

        if (typeof ChartDataLabels !== 'undefined') { Chart.register(ChartDataLabels); }

        adminChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Hadir', 'Sakit', 'Izin', 'Alpa', 'Belum Absen'],
                datasets: [{
                    label: 'Jumlah Siswa',
                    data: [hadir, sakit, izin, alpa, belum],
                    backgroundColor: [
                        '#10B981', // Emerald (Hadir)
                        '#EAB308', // Yellow (Sakit)
                        '#3B82F6', // Blue (Izin)
                        '#EF4444', // Red (Alpa)
                        '#9CA3AF'  // Gray (Belum)
                    ],
                    borderRadius: 8,
                    barPercentage: 0.5,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        formatter: (val) => val > 0 ? val : '',
                        font: { weight: 'bold' },
                        color: '#666'
                    }
                },
                scales: {
                    y: { beginAtZero: true, grid: { borderDash: [2, 2] } },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    // --- WAKA: TOP 5 SISWA PALING PAGI ---
    function loadWakaTopPagi() {
        const listEl = document.getElementById('wakaTopPagiList');
        if (!listEl) return;

        listEl.innerHTML = '<div class="text-center text-xs text-gray-400 py-8"><i class="fas fa-circle-notch fa-spin mr-1"></i> Memuat data...</div>';

        gas.run
            .withSuccessHandler(res => {
                if (!res.success) {
                    listEl.innerHTML = `<div class="text-center text-xs text-red-400 py-8">Gagal memuat data: ${res.message}</div>`;
                    return;
                }
                const list = res.data || [];
                if (!list.length) {
                    listEl.innerHTML = `
                        <div class="text-center text-xs text-gray-400 py-8">
                            <i class="fas fa-inbox text-2xl text-gray-200 block mb-2"></i>
                            Belum ada data presensi untuk dihitung.
                        </div>`;
                    return;
                }

                const medalStyle = [
                    'bg-gradient-to-br from-yellow-300 to-yellow-500 text-white shadow-md shadow-yellow-200',
                    'bg-gradient-to-br from-slate-300 to-slate-400 text-white shadow-md shadow-slate-200',
                    'bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow-md shadow-orange-200',
                    'bg-gray-100 text-gray-500',
                    'bg-gray-100 text-gray-500'
                ];
                const medalIcon = ['🥇', '🥈', '🥉', '', ''];

                listEl.innerHTML = list.map((s, i) => {
                    const initials = String(s.nama || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
                    const jamTampil = (s.rataJam || '').slice(0, 5); // HH:mm
                    return `
                    <div class="flex items-center gap-3 sm:gap-4 p-3 rounded-xl border border-gray-100 hover:bg-amber-50/60 hover:border-amber-200 transition">
                        <div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${medalStyle[i] || medalStyle[4]}">
                            ${medalIcon[i] || (i + 1)}
                        </div>
                        <div class="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs flex-shrink-0">
                            ${initials || '?'}
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-bold text-sm text-gray-800 truncate">${s.nama || '-'}</p>
                            <p class="text-[10px] text-gray-400">${s.kelas || '-'} · ${s.jumlahHari} hari tercatat</p>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <p class="font-bold text-emerald-600 text-sm">${jamTampil}</p>
                            <p class="text-[10px] text-gray-400">rata-rata jam datang</p>
                        </div>
                    </div>`;
                }).join('');
            })
            .withFailureHandler(err => {
                listEl.innerHTML = `<div class="text-center text-xs text-red-400 py-8">Error: ${String(err && err.message ? err.message : err)}</div>`;
            })
            .getTopSiswaPalingPagi(5);
    }

// ============================================================
// DAFTAR HADIR GURU — Logika JavaScript
// ============================================================
let dhStudents      = [];   // [{nis, nama, kelas}] list siswa aktif
let dhStatusMap     = {};   // {nis: 'hadir'|'sakit'|'izin'|'alpa'}
let dhCamStream     = null; // kept for compatibility
let dhScanLoop      = null; // kept for compatibility
let dhLastScan      = 0;
let dhCamActive     = false; // kept for compatibility
let dhTorchOn       = false;
let dhTorchTrack    = null;
let dhCamFacing     = 'environment'; // kept for compatibility
let dhZxingReader   = null; // kept for compatibility
let dhMode          = 'masuk'; // 'masuk' | 'pulang'
let dhPulangMap     = {}; // { nis: { rowIndex, jamDatang, jamPulang, checked } }
let dhLockedMap     = {}; // { nis: status } — sudah absen, tidak bisa diubah

// -- Set mode Masuk / Pulang --
function dhSetMode(mode) {
    dhMode = mode;
    const btnMasuk  = document.getElementById('dhModeMasukBtn');
    const btnPulang = document.getElementById('dhModePulangBtn');
    const slider    = document.getElementById('dhModeSlider');
    const hMasuk    = document.getElementById('dhTheadMasuk');
    const hPulang   = document.getElementById('dhTheadPulang');
    const counterLbl= document.getElementById('dhCounterLabel');
    const submitLbl = document.getElementById('dhSubmitLabel');
    const header    = document.getElementById('dhScanCardHeader');
    const camBtn    = document.getElementById('dhCamBtn');
    const title     = document.getElementById('dhScanCardTitle');
    const sub       = document.getElementById('dhScanCardSub');
    const pollTxt   = document.getElementById('dhPollingText');

    if (mode === 'masuk') {
        // Slider
        if (slider) { slider.className = 'dh-mode-slider masuk'; }
        if (btnMasuk)  { btnMasuk.className  = 'dh-mode-btn active'; }
        if (btnPulang) { btnPulang.className = 'dh-mode-btn inactive'; }
        hMasuk.classList.remove('hidden'); hPulang.classList.add('hidden');
        if (counterLbl) counterLbl.textContent = 'Terisi:';
        if (submitLbl)  submitLbl.textContent  = 'Kirim Presensi';
        if (header) header.className = 'bg-gradient-to-r from-purple-600 to-indigo-600 p-4 text-white text-center';
        if (camBtn) { camBtn.className = 'w-full bg-purple-600 hover:bg-purple-700 active:scale-95 text-white py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-md'; camBtn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Live'; }
        if (title) title.textContent = 'Scan QR Siswa';
        if (sub)   sub.textContent   = 'Scan tersimpan di perangkat, kirim lewat Sinkron';
        if (pollTxt) pollTxt.textContent = 'Kamera aktif — menunggu QR...';
    } else {
        // Slider
        if (slider) { slider.className = 'dh-mode-slider pulang'; }
        if (btnPulang) { btnPulang.className = 'dh-mode-btn active'; }
        if (btnMasuk)  { btnMasuk.className  = 'dh-mode-btn inactive'; }
        hPulang.classList.remove('hidden'); hMasuk.classList.add('hidden');
        if (counterLbl) counterLbl.textContent = 'Dipilih:';
        if (submitLbl)  submitLbl.textContent  = 'Catat Pulang';
        if (header) header.className = 'bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white text-center';
        if (camBtn) { camBtn.className = 'w-full bg-orange-500 hover:bg-orange-600 active:scale-95 text-white py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-md'; camBtn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Pulang'; }
        if (title) title.textContent = 'Scan QR Pulang';
        if (sub)   sub.textContent   = 'Scan tersimpan di perangkat, kirim lewat Sinkron';
        if (pollTxt) pollTxt.textContent = 'Kamera aktif — scan QR untuk pulang...';
    }
    onDhKelasChange();
}

// -- Buka halaman --
// Deteksi apakah filter kelas yang aktif mewakili "lebih dari satu kelas"
// (literal SEMUA milik admin/guru-wali-semua-kelas, ATAU daftar gabungan
// beberapa kelas milik guru, mis. "VI A,VI B")
function dhIsSemuaFilter(v) {
    v = String(v || '');
    return v.toUpperCase() === 'SEMUA' || v.includes(',');
}

function loadDaftarHadirGuru() {
    dhStopPopup();
    dhMode = 'masuk';
    setActiveMenu('Daftar Hadir');
    showView('view-daftar-hadir-guru');

    // Reset mode toggle tampilan
    dhSetMode('masuk');

    // Isi tanggal hari ini
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dhTanggal').value = today;

    const sel = document.getElementById('dhKelasSelect');
    sel.innerHTML = '<option value="">-- Pilih Kelas --</option>';

    if (currentUser && currentUser.role === 'admin') {
        // Admin: muat semua kelas dari database (dengan cadangan localStorage buat offline)
        sel.innerHTML = '<option value="">Memuat kelas...</option>';
        sel.disabled = true;

        const isiDropdownKelas = (kelasList) => {
            sel.disabled = false;
            sel.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
                '<option value="SEMUA">📋 Semua Kelas</option>';
            kelasList.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k;
                sel.appendChild(opt);
            });
            restoreLastKelasDipilih(sel, 'dh');
        };

        if (!navigator.onLine) {
            // Offline -> langsung pakai cadangan, jangan nunggu/gagal ke server
            const cached = loadKelasListFromStorage('dh');
            if (cached) { isiDropdownKelas(cached); }
            else { sel.disabled = false; sel.innerHTML = '<option value="">-- Offline, belum ada data kelas tersimpan --</option>'; }
        } else {
            gas.run
                .withSuccessHandler(result => {
                    const kelasList = (result && result.success && result.data) ? result.data : [];
                    try { localStorage.setItem('dhKelasListBackup', JSON.stringify(kelasList)); } catch(e) {}
                    isiDropdownKelas(kelasList);
                })
                .withFailureHandler(() => {
                    const cached = loadKelasListFromStorage('dh');
                    if (cached) { isiDropdownKelas(cached); }
                    else { sel.disabled = false; sel.innerHTML = '<option value="">-- Gagal memuat kelas --</option>'; }
                })
                .getKelasList();
        }
    } else {
        // Guru: tampilkan kelas miliknya (+ opsi Semua Kelas jika lebih dari satu)
        if (currentUser && currentUser.kelas) {
            const kelasList = String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean);

            if (kelasList.length > 1) {
                const optSemua = document.createElement('option');
                optSemua.value = kelasList.join(',');
                optSemua.textContent = '📋 Semua Kelas Saya';
                sel.appendChild(optSemua);
            }

            kelasList.forEach(k => {
                const opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k;
                sel.appendChild(opt);
            });
            if (kelasList.length === 1) {
                sel.value = kelasList[0];
                onDhKelasChange();
            }
        } else if (currentUser) {
            // Guru "Wali Kelas Semua Kelas" (tidak dibatasi kelas tertentu) -- dengan cadangan localStorage
            sel.innerHTML = '<option value="">-- Pilih Kelas --</option>' +
                '<option value="SEMUA">📋 Semua Kelas</option>';
            sel.disabled = true;

            const isiOpsiKelas = (kelasListAll) => {
                sel.disabled = false;
                kelasListAll.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k;
                    opt.textContent = k;
                    sel.appendChild(opt);
                });
                restoreLastKelasDipilih(sel, 'dh');
            };

            if (!navigator.onLine) {
                const cached = loadKelasListFromStorage('dh');
                sel.disabled = false;
                if (cached) isiOpsiKelas(cached);
            } else {
                gas.run
                    .withSuccessHandler(result => {
                        const kelasListAll = (result && result.success && result.data) ? result.data : [];
                        try { localStorage.setItem('dhKelasListBackup', JSON.stringify(kelasListAll)); } catch(e) {}
                        isiOpsiKelas(kelasListAll);
                    })
                    .withFailureHandler(() => {
                        const cached = loadKelasListFromStorage('dh');
                        sel.disabled = false;
                        if (cached) isiOpsiKelas(cached);
                    })
                    .getKelasList();
            }
        }
    }
}

// -- Ketika kelas atau tanggal berubah --
// Ambil daftar siswa per kelas, dengan cadangan localStorage per-kelas buat offline/gagal konek.
function getSiswaByKelasCached(kelas, onSuccess, onFail, onFresh) {
    const cacheKey = 'dhSiswaByKelas:' + kelas;
    const readCache = () => {
        try {
            const raw = localStorage.getItem(cacheKey);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    };
    const cached = readCache();

    if (!navigator.onLine) {
        if (cached) onSuccess(cached); else onFail();
        return;
    }

    // STALE-WHILE-REVALIDATE: kalau ada cache & pemanggil menyediakan onFresh, tampilkan
    // cache SEKARANG (0 detik), lalu ambil data terbaru di latar belakang. onFresh hanya
    // dipanggil kalau isinya memang berubah.
    if (cached && cached.length && typeof onFresh === 'function') {
        onSuccess(cached);
        gas.run
            .withSuccessHandler(result => {
                const fresh = result || [];
                try { localStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch (e) {}
                if (JSON.stringify(fresh) !== JSON.stringify(cached)) onFresh(fresh);
            })
            .withFailureHandler(() => { /* cache sudah tampil, abaikan */ })
            .getSiswaByKelas(kelas);
        return;
    }

    gas.run
        .withSuccessHandler(result => {
            try { localStorage.setItem(cacheKey, JSON.stringify(result || [])); } catch (e) {}
            onSuccess(result);
        })
        .withFailureHandler(() => {
            if (cached) onSuccess(cached); else onFail();
        })
        .getSiswaByKelas(kelas);
}

let dhKelasReqSeq = 0; // penanda request terbaru, supaya respons lama tidak menimpa tampilan

function onDhKelasChange() {
    const kelas   = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;
    if (!kelas) return;
    saveLastKelasDipilih('dh', kelas);

    const seq  = ++dhKelasReqSeq;
    const mode = dhMode;

    dhStudents  = [];
    dhStatusMap = {};
    dhPulangMap = {};
    dhLockedMap = {};
    document.getElementById('dhCounter').textContent = '0 / 0';
    document.getElementById('dhSubmittedBanner').classList.add('hidden');
    dhUpdateSubmitBtn();

    const colspan = mode === 'pulang' ? 5 : 3;
    const tbody = document.getElementById('dhSiswaTbody');
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="py-8 text-center text-gray-400"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat siswa...</td></tr>`;

    if (mode === 'pulang' && !tanggal) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-gray-400">Pilih tanggal.</td></tr>`;
        return;
    }

    // Daftar siswa & status presensi tidak saling bergantung -> DIKIRIM BERSAMAAN (paralel),
    // bukan berurutan. Tabel digambar begitu keduanya siap.
    let studentsReady = false;
    let statusReady   = false;
    let statusRes     = null;

    const renderNow = () => { if (mode === 'pulang') dhRenderPulangTable(); else dhRenderStudentTable(); };

    const applyStatus = () => {
        const res = statusRes;
        if (mode === 'pulang') {
            dhPulangMap = {};
            if (res && res.success && res.data) {
                Object.entries(res.data).forEach(([nis, d]) => {
                    dhPulangMap[nis] = { ...d, checked: false };
                });
            }
        } else {
            dhLockedMap = {};
            dhStatusMap = {};
            if (res && res.success && res.data && Object.keys(res.data).length > 0) {
                document.getElementById('dhSubmittedBanner').classList.remove('hidden');
                Object.entries(res.data).forEach(([nis, d]) => {
                    // Simpan seluruh objek agar bisa tampilkan jam di UI
                    if (d && typeof d === 'object') {
                        dhLockedMap[nis] = d; // { status, jamDatang, hasJamDatang }
                    } else {
                        dhLockedMap[nis] = { status: d, jamDatang: '', hasJamDatang: true };
                    }
                });
            }
        }
    };

    const tryRender = () => {
        if (seq !== dhKelasReqSeq) return;           // sudah kesusul pilihan kelas/tanggal baru
        if (!studentsReady || !statusReady) return;  // tunggu pasangannya
        applyStatus();
        renderNow();
    };

    // (a) Status presensi (kalau ada tanggal) -- langsung dikirim
    if (mode === 'pulang' || tanggal) {
        const runner = gas.run
            .withSuccessHandler(res => { statusRes = res; statusReady = true; tryRender(); })
            .withFailureHandler(() => { statusRes = null; statusReady = true; tryRender(); });
        if (mode === 'pulang') runner.getDaftarHadirDetailByKelasAndTanggal(kelas, tanggal);
        else runner.getDaftarHadirByKelasAndTanggal(kelas, tanggal);
    } else {
        statusReady = true;
    }

    // (b) Daftar siswa -- cache lokal tampil dulu, data terbaru menyusul di latar belakang
    getSiswaByKelasCached(kelas,
        result => {
            if (seq !== dhKelasReqSeq) return;
            dhStudents = result || [];
            studentsReady = true;
            tryRender();
        },
        () => {
            if (seq !== dhKelasReqSeq) return;
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="py-8 text-center text-red-400">Gagal memuat data siswa.</td></tr>`;
        },
        fresh => {
            if (seq !== dhKelasReqSeq) return;
            dhStudents = fresh || [];
            if (studentsReady && statusReady) renderNow(); // status & centang yang sudah ada tetap dipertahankan
        }
    );
}

// -- Render tabel siswa --
function dhRenderStudentTable() {
    const tbody = document.getElementById('dhSiswaTbody');
    if (!dhStudents || dhStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="py-12 text-center text-gray-400"><i class="fas fa-user-slash mr-2"></i>Tidak ada siswa di kelas ini.</td></tr>';
        return;
    }

    const statusConfig = {
        hadir: { label: 'Hadir', bg: 'bg-emerald-500', ring: 'ring-emerald-300', text: 'text-emerald-700', rowBg: 'bg-emerald-50' },
        sakit: { label: 'Sakit', bg: 'bg-yellow-400',  ring: 'ring-yellow-200',  text: 'text-yellow-700',  rowBg: 'bg-yellow-50'  },
        izin:  { label: 'Izin',  bg: 'bg-blue-400',    ring: 'ring-blue-200',    text: 'text-blue-700',    rowBg: 'bg-blue-50'    },
        alpa:  { label: 'Alpa',  bg: 'bg-red-400',     ring: 'ring-red-200',     text: 'text-red-700',     rowBg: 'bg-red-50'     },
    };

    tbody.innerHTML = dhStudents.map((s, i) => {
        const lockedRaw = dhLockedMap[s.nis] || null;
        const locked = lockedRaw !== null; // boolean
        const st   = locked
            ? (lockedRaw && typeof lockedRaw === 'object' ? lockedRaw.status : String(lockedRaw))
            : (dhStatusMap[s.nis] || '');
        const cfg  = statusConfig[st] || null;
        const rowBg = locked ? 'bg-gray-50 opacity-60' : (cfg ? cfg.rowBg : '');
        const isLastScan = s.nis === dhLastScannedNis;
        const isSemua = dhIsSemuaFilter(document.getElementById('dhKelasSelect').value);
        return `
        <tr id="dh-row-${s.nis}" class="${isLastScan ? 'dh-row-last-scan' : rowBg} border-b border-gray-50 transition-colors duration-500">
          <td class="px-3 py-3 text-center text-xs text-gray-400">${i+1}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full ${cfg ? cfg.bg : 'bg-gray-200'} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                ${cfg ? cfg.label[0] : s.nama.charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="font-semibold text-sm text-gray-800">${s.nama}</div>
                <div class="text-[10px] text-gray-400 font-mono">${s.nis}${isSemua ? ` <span class="ml-1 bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-bold">${s.kelas}</span>` : ''}</div>
              </div>
            </div>
          </td>
          <td class="px-3 py-3">
            ${locked
              ? (() => {
                   const lockedData = dhLockedMap[s.nis];
                   const jamTxt = (lockedData && typeof lockedData === 'object' && lockedData.jamDatang) ? lockedData.jamDatang : '';
                   const statusLabel = cfg ? cfg.label : (typeof lockedData === 'string' ? lockedData : (lockedData && lockedData.status ? lockedData.status : '?'));
                   const bgClass = cfg ? cfg.bg + ' text-white' : 'bg-gray-200 text-gray-500';
                   return `<div class="flex flex-col items-center gap-1">
                     <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold ${bgClass}">
                       <i class="fas fa-lock text-[8px]"></i> ${statusLabel}
                     </span>
                     <span class="text-[9px] text-gray-400">${jamTxt ? '🕐 ' + jamTxt : 'Sudah tercatat'}</span>
                   </div>`;
                 })()
              : `<div class="flex justify-center gap-1 flex-wrap">
                   ${['hadir','sakit','izin','alpa'].map(status => {
                     const c = statusConfig[status];
                     const active = st === status;
                     const btnClass = 'px-2 py-1 rounded-lg text-[10px] font-bold transition border ' + (active ? c.bg + ' text-white ring-2 ' + c.ring + ' border-transparent shadow-sm' : 'bg-gray-100 text-gray-500 border-gray-200 hover:border-gray-300');
                     const btnTitle = active ? 'Klik untuk batalkan' : c.label;
                     const btnLabel = active ? '✕ ' + c.label : c.label;
                     return `<button onclick="dhSetStatus('${s.nis}','${status}')" title="${btnTitle}" class="${btnClass}">${btnLabel}</button>`;
                   }).join('')}
                 </div>`
            }
          </td>
        </tr>`;
    }).join('');

    dhUpdateCounter();
}

// -- Set status satu siswa (klik ulang = batalkan) --
function dhSetStatus(nis, status) {
    if (dhStatusMap[nis] === status) {
        // Klik status yang sudah aktif → batalkan
        delete dhStatusMap[nis];
    } else {
        dhStatusMap[nis] = status;
    }
    dhRenderStudentTable();
    const row = document.getElementById('dh-row-' + nis);
    if (row) {
        row.classList.add('dh-row-flash');
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => row.classList.remove('dh-row-flash'), 800);
    }
}

// -- Tandai semua hadir --
function dhTandaiSemua() {
    if (dhMode === 'pulang') {
        // Centang semua siswa yang sudah datang tapi belum pulang
        let count = 0;
        dhStudents.forEach(s => {
            const d = dhPulangMap[s.nis];
            const sudahDatang = d && d.status === 'hadir' && d.jamDatang;
            const sudahPulang = d && d.jamPulang && d.jamPulang.trim() !== '';
            if (sudahDatang && !sudahPulang) {
                dhPulangMap[s.nis].checked = true;
                count++;
            }
        });
        dhRenderPulangTable();
        if (count === 0) showAlert('error', 'Tidak ada siswa yang bisa ditandai pulang.');
    } else {
        // Tandai semua yang belum terkunci (belum absen)
        dhStudents.forEach(s => { if (!dhLockedMap[s.nis]) dhStatusMap[s.nis] = 'hadir'; });
        dhRenderStudentTable();
    }
}

// -- Update counter & tombol kirim --
function dhUpdateCounter() {
    if (dhMode === 'pulang') {
        const checked = Object.values(dhPulangMap).filter(d => d.checked).length;
        document.getElementById('dhCounter').textContent = checked + ' dipilih';
        dhUpdateSubmitBtn();
        return;
    }
    const total   = dhStudents.length;
    const locked  = Object.keys(dhLockedMap).filter(k => dhStudents.find(s => s.nis === k)).length;
    const filled  = Object.keys(dhStatusMap).filter(k => dhStudents.find(s => s.nis === k) && !dhLockedMap[k]).length;
    const unset   = total - locked - filled;
    document.getElementById('dhCounter').textContent = filled + ' baru / ' + unset + ' belum (' + locked + ' terkunci)';
    dhUpdateSubmitBtn();
}

function dhUpdateSubmitBtn() {
    const btn = document.getElementById('dhSubmitBtn');
    let enabled = false;
    if (dhMode === 'pulang') {
        enabled = Object.values(dhPulangMap).some(d => d.checked);
        btn.className = enabled
            ? 'bg-orange-500 hover:bg-orange-600 active:scale-95 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 flex-shrink-0 shadow-md'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 flex-shrink-0';
    } else {
        enabled = Object.keys(dhStatusMap).filter(k => dhStudents.find(s => s.nis === k) && !dhLockedMap[k]).length > 0;
        btn.className = enabled
            ? 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 flex-shrink-0 shadow-md'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 flex-shrink-0';
    }
    btn.disabled = !enabled;
}

// -- Render tabel pulang --
function dhRenderPulangTable() {
    const tbody = document.getElementById('dhSiswaTbody');
    if (!dhStudents || dhStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-gray-400"><i class="fas fa-user-slash mr-2"></i>Tidak ada siswa di kelas ini.</td></tr>';
        return;
    }
    tbody.innerHTML = dhStudents.map((s, i) => {
        const d = dhPulangMap[s.nis];
        const sudahDatang  = d && d.status === 'hadir' && d.jamDatang;
        const sudahPulang  = d && d.jamPulang && d.jamPulang.trim() !== '';
        const checked      = d && d.checked;
        const jamDatangTxt = d && d.jamDatang ? d.jamDatang : '-';
        const jamPulangTxt = sudahPulang ? d.jamPulang : '-';
        const rowBg        = sudahPulang ? 'bg-green-50' : (sudahDatang ? 'bg-orange-50' : '');
        const isSemua = dhIsSemuaFilter(document.getElementById('dhKelasSelect').value);
        return `
        <tr id="dhp-row-${s.nis}" class="${rowBg} border-b border-gray-50 transition-colors duration-300">
          <td class="px-3 py-3 text-center text-xs text-gray-400">${i+1}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full ${sudahPulang ? 'bg-green-500' : sudahDatang ? 'bg-orange-400' : 'bg-gray-200'} flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                ${s.nama.charAt(0).toUpperCase()}
              </div>
              <div>
                <div class="font-semibold text-sm text-gray-800">${s.nama}</div>
                <div class="text-[10px] text-gray-400 font-mono">${s.nis}${isSemua ? ` <span class="ml-1 bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-bold">${s.kelas}</span>` : ''}</div>
              </div>
            </div>
          </td>
          <td class="px-3 py-3 text-center text-xs font-bold ${sudahDatang ? 'text-indigo-600' : 'text-gray-300'}">${jamDatangTxt}</td>
          <td class="px-3 py-3 text-center text-xs font-bold ${sudahPulang ? 'text-green-600' : 'text-gray-300'}">${jamPulangTxt}</td>
          <td class="px-3 py-3 text-center">
            ${sudahPulang
              ? '<span class="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-1 rounded-lg"><i class="fas fa-check mr-1"></i>Sudah Pulang</span>'
              : sudahDatang
                ? `<label class="flex items-center justify-center gap-1.5 cursor-pointer">
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="dhTogglePulang('${s.nis}', this.checked)"
                      class="w-4 h-4 accent-orange-500 cursor-pointer">
                    <span class="text-xs font-bold text-gray-600">Tandai Pulang</span>
                  </label>`
                : '<span class="text-[10px] text-gray-300 italic">Belum Absen Masuk</span>'
            }
          </td>
        </tr>`;
    }).join('');
    dhUpdateCounter();
}

function dhTogglePulang(nis, checked) {
    if (dhPulangMap[nis]) {
        dhPulangMap[nis].checked = checked;
    } else {
        dhPulangMap[nis] = { checked };
    }
    dhUpdateCounter();
}

// -- Dispatch submit sesuai mode --
function dhHandleSubmit() {
    if (dhMode === 'pulang') {
        submitPulang();
    } else {
        submitDaftarHadir();
    }
}

// -- Kirim pulang ke server --
function submitPulang() {
    const kelas   = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;
    if (!kelas || !tanggal) { showAlert('error', 'Pilih kelas dan tanggal.'); return; }

    const jamAksiBatchPulang = formatJamAksi();
    const pulangList = Object.entries(dhPulangMap)
        .filter(([, d]) => d.checked)
        .map(([nis]) => ({ nis, jamAksi: jamAksiBatchPulang }));

    if (pulangList.length === 0) { showAlert('error', 'Belum ada siswa yang dipilih untuk pulang.'); return; }

    const kelasLabelPulang = dhIsSemuaFilter(kelas) ? 'Semua Kelas' : kelas;
    Swal.fire({
        title: 'Catat Pulang?',
        html: `<p class="text-gray-500 text-sm">Kelas: <b>${kelasLabelPulang}</b> &bull; Tanggal: <b>${tanggal}</b></p>
               <p class="mt-2 text-sm"><b>${pulangList.length}</b> siswa akan dicatat pulang sekarang.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#f97316',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '&#10003; Ya, Catat',
        cancelButtonText: 'Batal'
    }).then(res => {
        if (!res.isConfirmed) return;
        showLoading();
        queueOfflineAction('Absen Pulang (Batch)', 'submitPulangGuru', [pulangList, tanggal, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru'], `${pulangList.length} siswa`)
            .then(outcome => {
                hideLoading();
                if (outcome.viaServer) {
                    const result = outcome.result;
                    if (result.success) {
                        Swal.fire({ icon: 'success', title: 'Berhasil!', text: result.message, timer: 2000, showConfirmButton: false });
                        onDhKelasChange(); // refresh
                    } else {
                        Swal.fire('Gagal', result.message, 'error');
                    }
                } else {
                    Swal.fire({ icon: 'info', title: 'Tersimpan Offline', text: `${pulangList.length} data disimpan di perangkat, akan terkirim otomatis saat sinkron.`, timer: 2500, showConfirmButton: false });
                }
            });
    });
}

// -- Kirim ke server --
function submitDaftarHadir() {
    const kelas   = document.getElementById('dhKelasSelect').value;
    const tanggal = document.getElementById('dhTanggal').value;
    if (!kelas || !tanggal) { showAlert('error', 'Pilih kelas dan tanggal terlebih dahulu.'); return; }

    // Hanya kirim siswa yang belum pernah absen (tidak terkunci)
    // jamAksi dicatat DI SINI (saat tombol Kirim ditekan) -- ini momen paling mendekati
    // waktu aksi asli untuk submit batch (guru sudah menandai status sebelumnya di layar).
    const jamAksiBatch = formatJamAksi();
    const dataList = dhStudents
        .filter(s => dhStatusMap[s.nis] && !dhLockedMap[s.nis])
        .map(s => ({ nis: s.nis, nama: s.nama, kelas: s.kelas, status: dhStatusMap[s.nis], jamAksi: jamAksiBatch }));

    if (dataList.length === 0) { showAlert('error', 'Belum ada siswa yang diisi statusnya.'); return; }

    const kelasLabel = dhIsSemuaFilter(kelas) ? 'Semua Kelas' : kelas;
    const hadir = dataList.filter(d => d.status === 'hadir').length;
    const lain  = dataList.length - hadir;

    Swal.fire({
        title: 'Kirim Presensi?',
        html: `<p class="text-gray-500 text-sm">Kelas: <b>${kelasLabel}</b> &bull; Tanggal: <b>${tanggal}</b></p>
               <div class="flex justify-center gap-4 mt-3 text-sm">
                 <span class="text-emerald-600 font-bold">${hadir} Hadir</span>
                 <span class="text-yellow-600 font-bold">${lain} Lainnya</span>
               </div>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '&#10003; Ya, Kirim',
        cancelButtonText: 'Batal'
    }).then(res => {
        if (!res.isConfirmed) return;
        showLoading();
        queueOfflineAction('Absen Masuk (Batch)', 'submitDaftarHadirGuru', [dataList, tanggal, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru'], `${dataList.length} siswa`)
            .then(outcome => {
                hideLoading();
                if (outcome.viaServer) {
                    const result = outcome.result;
                    if (result.success) {
                        Swal.fire({
                            icon: 'success',
                            title: 'Presensi Tersimpan!',
                            text: result.message,
                            timer: 2000,
                            showConfirmButton: false
                        });
                        // Refresh tabel agar banner "sudah dikirim" muncul
                        onDhKelasChange();
                    } else {
                        Swal.fire('Gagal', result.message, 'error');
                    }
                } else {
                    Swal.fire({ icon: 'info', title: 'Tersimpan Offline', text: `${dataList.length} data disimpan di perangkat, akan terkirim otomatis saat sinkron.`, timer: 2500, showConfirmButton: false });
                }
            });
    });
}

// ---- KAMERA POPUP (Daftar Hadir Guru) ----
let dhCameraPopup     = null;
let dhPollingInterval = null;
const DH_LS_KEY       = 'dh_qr_result';

// Listener postMessage dari popup kamera DH
window.addEventListener('message', function(event) {
    if (!event.data || event.data.type !== 'DH_QR_SCAN_RESULT') return;
    const kodeKartu = event.data.nis;
    if (!kodeKartu || typeof kodeKartu !== 'string') return;
    if (event.data.ts && (Date.now() - event.data.ts) > 30000) return;
    dhOnScanResult(kodeKartu); // feedback ke popup (sukses/duplikat/error) dikirim dari dalam fungsi ini
});

function dhStopPolling() {
    if (dhPollingInterval) { clearInterval(dhPollingInterval); dhPollingInterval = null; }
    const ps = document.getElementById('dhPollingStatus');
    if (ps) ps.classList.add('hidden');
    const btn = document.getElementById('dhCamBtn');
    if (btn) {
        btn.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Live';
    }
}

function dhStartPolling() {
    dhStopPolling();
    try { localStorage.removeItem(DH_LS_KEY); } catch(e) {}
    const ps = document.getElementById('dhPollingStatus');
    if (ps) ps.classList.remove('hidden');
    const btn = document.getElementById('dhCamBtn');
    if (btn) btn.classList.add('hidden');

    dhPollingInterval = setInterval(() => {
        if (dhCameraPopup && dhCameraPopup.closed) {
            dhCameraPopup = null;
            dhStopPolling();
            return;
        }
        try {
            const raw = localStorage.getItem(DH_LS_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (Date.now() - data.ts > 30000) { localStorage.removeItem(DH_LS_KEY); return; }
            localStorage.removeItem(DH_LS_KEY);
            dhOnScanResult(data.nis);
        } catch(e) {}
    }, 300);
}

function dhStopPopup() {
    if (dhCameraPopup && !dhCameraPopup.closed) { dhCameraPopup.close(); dhCameraPopup = null; }
    dhStopPolling();
}

function dhOpenCameraPopup() {
    // Cek apakah kelas sudah dipilih
    const kelas = document.getElementById('dhKelasSelect')?.value;
    if (!kelas) {
        showAlert('error', 'Pilih kelas terlebih dahulu sebelum membuka kamera.');
        return;
    }

    try { localStorage.removeItem(DH_LS_KEY); } catch(e) {}

    const lsKeyVal = DH_LS_KEY;
    const popupHTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scan QR - Daftar Hadir</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:${dhMode==='pulang'?'#1c0a00':'#0f172a'};color:white;font-family:'Segoe UI',sans-serif;
       display:flex;flex-direction:column;align-items:center;
       min-height:100vh;padding:8px 10px;gap:6px;overflow-x:hidden;}
  h2{font-size:11px;font-weight:700;color:#e2e8f0;letter-spacing:1px;margin-top:2px;}

  /* Notifikasi atas */
  #scanNotif{display:none;position:fixed;top:0;left:0;right:0;z-index:999;
    padding:8px 14px 10px;text-align:center;
    border-bottom:1px solid rgba(255,255,255,.1);
    box-shadow:0 4px 20px rgba(0,0,0,.5);}
  #scanNotif.ok {background:linear-gradient(135deg,#065f46,#047857);display:block;}
  #scanNotif.err{background:linear-gradient(135deg,#7f1d1d,#b91c1c);display:block;}
  #scanNotif.pop{animation:popIn .3s cubic-bezier(.4,0,.2,1);}
  @keyframes popIn{0%{transform:translateY(-30px);opacity:0}100%{transform:translateY(0);opacity:1}}
  .n-label{font-size:8px;text-transform:uppercase;letter-spacing:1px;opacity:.5;color:#fff;margin-bottom:1px;}
  .n-icon{font-size:18px;display:block;line-height:1;margin-bottom:1px;}
  .n-nama{font-size:13px;font-weight:800;color:#fff;}

  /* Flash border */
  #flashOverlay{display:none;position:fixed;inset:0;z-index:998;pointer-events:none;border:4px solid transparent;}
  #flashOverlay.ok {display:block;border-color:#10b981;animation:ff .5s ease forwards;}
  #flashOverlay.err{display:block;border-color:#ef4444;animation:ff .5s ease forwards;}
  @keyframes ff{0%{opacity:1}100%{opacity:0}}

  /* Kelas badge */
  #kelasBadge{background:#7c3aed;border:1px solid #6d28d9;border-radius:8px;
    padding:4px 12px;font-size:10px;font-weight:700;color:#fff;letter-spacing:.5px;}

  #videoWrap{position:relative;width:100%;max-width:300px;}
  video{width:100%;border-radius:10px;display:block;background:#000;min-height:160px;object-fit:cover;}
  canvas{display:none;}

  .overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}
  .box{width:150px;height:150px;position:relative;}
  .corner{position:absolute;width:20px;height:20px;border-color:${dhMode==='pulang'?'#fb923c':'#a78bfa'};border-style:solid;}
  .tl{top:0;left:0;border-width:3px 0 0 3px;border-radius:5px 0 0 0;}
  .tr{top:0;right:0;border-width:3px 3px 0 0;border-radius:0 5px 0 0;}
  .bl{bottom:0;left:0;border-width:0 0 3px 3px;border-radius:0 0 0 5px;}
  .br{bottom:0;right:0;border-width:0 3px 3px 0;border-radius:0 0 5px 0;}
  .scanline{position:absolute;left:3px;right:3px;height:2px;
    background:linear-gradient(90deg,transparent,#a78bfa,#7c3aed,#a78bfa,transparent);
    top:6px;border-radius:2px;animation:scan 1.6s ease-in-out infinite;}
  @keyframes scan{0%{top:4px;opacity:1}100%{top:140px;opacity:.2}}
  .box.found .corner{border-color:#4ade80;}
  .box.found .scanline{background:linear-gradient(90deg,transparent,#4ade80,transparent);}

  #status{font-size:11px;color:#94a3b8;text-align:center;max-width:300px;min-height:28px;line-height:1.5;padding:0 6px;}
  #status.ok{color:#4ade80;font-weight:700;font-size:13px;}
  #status.err{color:#f87171;}

  #loading{color:#64748b;font-size:12px;text-align:center;}
  .spinner{width:28px;height:28px;border:3px solid #1e293b;border-top:3px solid #a78bfa;
    border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px;}
  @keyframes spin{to{transform:rotate(360deg);}}

  .btns{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;width:100%;max-width:300px;}
  button{flex:1;min-width:80px;background:#6d28d9;color:white;border:none;
    padding:9px 10px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;transition:background .2s;}
  button:hover{background:#5b21b6;}
  button.sec{background:#1e293b;border:1px solid #334155;}
  button.sec:hover{background:#334155;}
  button.retry{background:#059669;}
  button.retry:hover{background:#047857;}
</style>
</head>
<body>

<div id="scanNotif">
  <div class="n-label">Terakhir Di-scan</div>
  <span class="n-icon" id="nIcon">✅</span>
  <div class="n-nama" id="nNama"></div>
</div>
<div id="flashOverlay"></div>

<h2 id="popTitle">&#128247; ${dhMode === 'pulang' ? 'SCAN QR PULANG' : 'SCAN QR — DAFTAR HADIR'}</h2>
<div id="kelasBadge" style="background:${dhMode==='pulang'?'#ea580c':'#7c3aed'};border-color:${dhMode==='pulang'?'#c2410c':'#6d28d9'}">Kelas: ${kelas}</div>

<div id="loading">
  <div class="spinner"></div>
  <span>Meminta izin kamera...</span>
</div>

<div id="videoWrap" style="display:none">
  <video id="video" autoplay playsinline muted></video>
  <canvas id="canvas"></canvas>
  <canvas id="canvas2" style="display:none"></canvas>
  <div class="overlay">
    <div class="box" id="aimBox">
      <div class="corner tl"></div><div class="corner tr"></div>
      <div class="corner bl"></div><div class="corner br"></div>
      <div class="scanline"></div>
    </div>
  </div>
</div>

<div id="status">Arahkan QR siswa ke kamera</div>

<div class="btns">
  <button onclick="switchCam()">&#128260; Ganti Kamera</button>
  <button class="sec" onclick="window.close()">&#10005; Tutup</button>
</div>

<script>
var LS_KEY='${lsKeyVal}';
var stream=null, facing='environment', scanLoop=null, lastScan=0, isSendingResult=false;
var video=document.getElementById('video');
var canvas=document.getElementById('canvas');
var canvas2=document.getElementById('canvas2');
var ctx=canvas.getContext('2d',{willReadFrequently:true});
var ctx2=canvas2.getContext('2d',{willReadFrequently:true});
var statusEl=document.getElementById('status');
var loading=document.getElementById('loading');
var wrap=document.getElementById('videoWrap');
var aimBox=document.getElementById('aimBox');

async function startCam(f){
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    if(scanLoop){ clearInterval(scanLoop); scanLoop=null; }
    loading.style.display='block'; wrap.style.display='none';
    statusEl.className=''; statusEl.textContent='Memulai kamera...';
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:f==='environment'?{ideal:'environment'}:'user',width:{ideal:1280},height:{ideal:720}}
    });
    video.srcObject=stream;
    await new Promise((res,rej)=>{
      video.onloadedmetadata=()=>video.play().then(res).catch(rej);
      setTimeout(()=>rej(new Error('Timeout')),8000);
    });
    loading.style.display='none'; wrap.style.display='block';
    statusEl.textContent='Arahkan QR siswa ke kamera';
    beginScan();
  }catch(e){
    loading.style.display='none';
    statusEl.className='err';
    statusEl.innerHTML='Kamera gagal: '+e.name+'<br><small>'+e.message+'</small>';
    document.querySelector('.btns').innerHTML=
      '<button class="retry" onclick="startCam(facing)">&#128260; Coba Lagi</button>'+
      '<button class="sec" onclick="window.close()">&#10005; Tutup</button>';
  }
}

function switchCam(){ facing=facing==='environment'?'user':'environment'; startCam(facing); }

function beginScan(){
  if(typeof ZXing!=='undefined'){
    runZXing();
  } else {
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    s.onload=runZXing;
    s.onerror=runJsQR;
    document.head.appendChild(s);
  }
}

function runZXing(){
  try{
    var hints=new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
    hints.set(ZXing.DecodeHintType.ALSO_INVERTED,true);
    var reader=new ZXing.BrowserQRCodeReader(hints);
    scanLoop=setInterval(function(){
      if(video.readyState<video.HAVE_ENOUGH_DATA||isSendingResult)return;
      var W=video.videoWidth,H=video.videoHeight;
      canvas.width=W;canvas.height=H;
      ctx.drawImage(video,0,0,W,H);
      // Pass 1: original
      try{
        var lum=new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        var bmp=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
        var r=reader.decodeBitmap(bmp);
        if(r&&r.getText()){onDetected(r.getText());return;}
      }catch(e){}
      // Pass 2: kontras tinggi
      try{
        canvas2.width=W;canvas2.height=H;
        ctx2.filter='contrast(2) brightness(1.15)';
        ctx2.drawImage(video,0,0,W,H);
        ctx2.filter='none';
        var lum2=new ZXing.HTMLCanvasElementLuminanceSource(canvas2);
        var bmp2=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum2));
        var r2=reader.decodeBitmap(bmp2);
        if(r2&&r2.getText()){onDetected(r2.getText());return;}
      }catch(e){}
      // Pass 3: crop tengah 65%
      try{
        var cw=Math.round(W*0.65),ch=Math.round(H*0.65);
        var cx=Math.round((W-cw)/2),cy=Math.round((H-ch)/2);
        canvas2.width=cw;canvas2.height=ch;
        ctx2.filter='none';
        ctx2.drawImage(video,cx,cy,cw,ch,0,0,cw,ch);
        var lum3=new ZXing.HTMLCanvasElementLuminanceSource(canvas2);
        var bmp3=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum3));
        var r3=reader.decodeBitmap(bmp3);
        if(r3&&r3.getText()){onDetected(r3.getText());return;}
      }catch(e){}
    },120);
  }catch(e){ runJsQR(); }
}

function runJsQR(){
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  s.onload=function(){
    scanLoop=setInterval(function(){
      if(video.readyState<video.HAVE_ENOUGH_DATA||isSendingResult)return;
      var W=video.videoWidth,H=video.videoHeight;
      canvas.width=W;canvas.height=H;
      ctx.drawImage(video,0,0,W,H);
      var d=ctx.getImageData(0,0,W,H);
      var r=jsQR(d.data,W,H,{inversionAttempts:'attemptBoth'});
      if(r&&r.data) onDetected(r.data);
    },120);
  };
  document.head.appendChild(s);
}

function onDetected(text){
  var now=Date.now();
  if(now-lastScan<2000)return;
  lastScan=now;
  aimBox.classList.add('found');
  setTimeout(()=>aimBox.classList.remove('found'),600);
  handleResult(text);
}

// Terima feedback dari parent
window.addEventListener('message',function(ev){
  if(!ev.data)return;
  if(ev.data.type==='DH_SCAN_SUCCESS')
    showNotif('ok','✅',ev.data.nama||'Berhasil');
  else if(ev.data.type==='DH_SCAN_ERROR')
    showNotif('err','❌',ev.data.message||'NIS tidak ditemukan');
});

function showNotif(type,icon,teks){
  var n=document.getElementById('scanNotif');
  var f=document.getElementById('flashOverlay');
  if(!n)return;
  document.getElementById('nIcon').textContent=icon;
  document.getElementById('nNama').textContent=teks;
  n.className=''; void n.offsetWidth; n.className=type+' pop';
  if(f){ f.className=''; void f.offsetWidth; f.className=type==='ok'?'ok':'err';
    setTimeout(()=>f.className='',550); }
}

function handleResult(text){
  if(!text||text.trim()===''||isSendingResult)return;
  isSendingResult=true;
  statusEl.className='ok';
  statusEl.textContent='✓ Terdeteksi! Mengirim...';
  var nis=text.trim();
  // Kirim ke parent via postMessage
  try{
    if(window.opener&&!window.opener.closed)
      window.opener.postMessage({type:'DH_QR_SCAN_RESULT',nis:nis,ts:Date.now()},'*');
  }catch(e){}
  // Backup via localStorage
  try{ localStorage.setItem(LS_KEY,JSON.stringify({nis:nis,ts:Date.now()})); }catch(e){}
  setTimeout(function(){
    statusEl.className='';
    statusEl.textContent='Siap scan siswa berikutnya...';
    isSendingResult=false;
    lastScan=Date.now();
  },1800);
}

startCam(facing);
<\/script>
</body>
</html>`;

    const w = Math.min(360, screen.width - 40);
    const h = Math.min(500, screen.height - 60);
    const left = Math.round((screen.width - w) / 2);
    const top  = Math.round((screen.height - h) / 2);

    dhCameraPopup = window.open('', 'dh_qr_cam', `width=${w},height=${h},top=${top},left=${left},resizable=yes`);

    if (!dhCameraPopup) {
        showAlert('error', 'Popup diblokir! Klik ikon di URL bar → Izinkan popup, lalu coba lagi.');
        return;
    }

    try {
        dhCameraPopup.document.open();
        dhCameraPopup.document.write(popupHTML);
        dhCameraPopup.document.close();
    } catch(e) {
        const blob = new Blob([popupHTML], { type: 'text/html' });
        dhCameraPopup.location.href = URL.createObjectURL(blob);
    }

    dhStartPolling();
}

/**
 * Buka jendela "Tap Kartu Anda" -- pengganti input NIS manual. Popup ini punya
 * background menarik + kolom ketik NIS. Begitu NIS dikirim (Enter), dikirim ke
 * parent lewat postMessage type 'DH_QR_SCAN_RESULT' -- pesan yang SAMA dengan
 * yang dipakai popup kamera QR, jadi semua logic verifikasi/simpan yang sudah
 * ada otomatis kepakai tanpa duplikasi. Feedback sukses/gagal dari parent
 * (DH_SCAN_SUCCESS/DH_SCAN_ERROR) ditampilkan sebagai notifikasi besar di
 * tengah popup, hilang otomatis dalam 3 detik biar siap buat siswa berikutnya.
 */
function dhOpenTapKartuPopup() {
    const w = Math.min(480, screen.width - 40);
    const h = Math.min(640, screen.height - 60);
    const left = Math.round((screen.width - w) / 2);
    const top  = Math.round((screen.height - h) / 2);

    // Window dibuka DULU (sinkron, langsung dari klik user) biar gak keblokir
    // popup-blocker browser -- isinya baru ditulis belakangan setelah waktu
    // server didapat.
    dhCameraPopup = window.open('', 'dh_tap_kartu', `width=${w},height=${h},top=${top},left=${left},resizable=yes`);

    if (!dhCameraPopup) {
        showAlert('error', 'Popup diblokir! Klik ikon di URL bar → Izinkan popup, lalu coba lagi.');
        return;
    }

    const tulisKontenPopup = (offsetMs) => {
        const popupHTML = buildTapKartuPopupHtml('DH_QR_SCAN_RESULT', 'Absen Masuk / Pulang', offsetMs);
        try {
            dhCameraPopup.document.open();
            dhCameraPopup.document.write(popupHTML);
            dhCameraPopup.document.close();
        } catch (e) {
            const blob = new Blob([popupHTML], { type: 'text/html' });
            dhCameraPopup.location.href = URL.createObjectURL(blob);
        }
    };

    gas.run
        .withSuccessHandler(res => {
            const offset = (res && res.success) ? (res.epochMs - Date.now()) : 0;
            tulisKontenPopup(offset);
        })
        .withFailureHandler(() => tulisKontenPopup(0)) // offline/gagal -> pakai jam device apa adanya
        .getServerTime();
}

/**
 * Template HTML popup "Tap Kartu Anda" -- dipakai bersama oleh Daftar Hadir
 * (messageType 'DH_QR_SCAN_RESULT') dan Presensi Sholat (messageType
 * 'SHOLAT_QR_SCAN_RESULT'), supaya tampilan & perilaku konsisten di 2 tempat.
 */
function buildTapKartuPopupHtml(messageType, subtitle, serverOffsetMs) {
    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Tap Kartu Anda</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; position: relative;
    background: linear-gradient(-45deg, #ea580c, #dc2626, #f97316, #ea580c);
    background-size: 400% 400%;
    animation: gradientMove 12s ease infinite;
    color: #fff; text-align: center; padding: 20px;
  }
  @keyframes gradientMove {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .app-title { font-size: 50px; font-weight: 1200; letter-spacing: 0.5px; opacity: 0.95; margin-bottom: 2px; text-transform: uppercase; }
  .app-subtitle { font-size: 20px; opacity: 0.75; margin-bottom: 14px; font-weight: 600; }
  .clock-box { margin-bottom: 18px; }
  .clock-time { font-size: 100px; font-weight: 1500; letter-spacing: 1px; line-height: 1; font-variant-numeric: tabular-nums; text-shadow: 0 2px 12px rgba(0,0,0,0.25); }
  .clock-date { font-size: 30px; font-weight: 1000; opacity: 0.9; margin-top: 4px; text-transform: capitalize; }
  .card-icon {
    width: 76px; height: 76px; border-radius: 22px;
    background: rgba(255,255,255,0.15); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    font-size: 38px; margin-bottom: 16px;
    animation: floatIcon 2.4s ease-in-out infinite;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
  }
  @keyframes floatIcon { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  h1 { font-size: 24px; font-weight: 800; margin-bottom: 6px; letter-spacing: 0.3px; }
  p.sub { font-size: 13px; opacity: 0.85; margin-bottom: 26px; font-weight: 500; }
  .nis-input {
    width: 100%; max-width: 320px; text-align: center;
    font-size: 30px; font-weight: 800; letter-spacing: 2px;
    padding: 18px 16px; border-radius: 18px; border: none; outline: none;
    background: rgba(255,255,255,0.95); color: #1e293b;
    box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  }
  .nis-input:focus { box-shadow: 0 10px 40px rgba(0,0,0,0.3), 0 0 0 4px rgba(255,255,255,0.4); }
  .hint { margin-top: 16px; font-size: 11px; opacity: 0.65; }

  .overlay {
    position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
    flex-direction: column; background: rgba(15,23,42,0.92); z-index: 10;
    animation: fadeIn 0.25s ease;
  }
  .overlay.show { display: flex; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .check-circle {
    width: 110px; height: 110px; border-radius: 50%;
    background: #10b981; display: flex; align-items: center; justify-content: center;
    margin-bottom: 22px; animation: popIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
    box-shadow: 0 0 0 10px rgba(16,185,129,0.2);
  }
  .check-circle.error { background: #ef4444; box-shadow: 0 0 0 10px rgba(239,68,68,0.2); }
  .check-circle.duplicate { background: #f59e0b; box-shadow: 0 0 0 10px rgba(245,158,11,0.2); }
  .check-circle svg { width: 56px; height: 56px; }
  @keyframes popIn { 0% { transform: scale(0); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

  .overlay-nama { font-size: 26px; font-weight: 900; padding: 0 24px; line-height: 1.25; margin-bottom: 4px; }
  .overlay-text { font-size: 15px; font-weight: 700; opacity: 0.9; margin-bottom: 10px; }
  .overlay-status {
    font-size: 13px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;
    padding: 6px 18px; border-radius: 999px; background: rgba(255,255,255,0.22);
  }
  .overlay-sub { font-size: 12px; opacity: 0.7; margin-top: 14px; }
</style>
</head>
<body>
  <div class="app-title">Presensi Digital SMPN 1 Ara</div>
  <div class="clock-box">
    <div class="clock-time" id="clockTime">--:--:--</div>
    <div class="clock-date" id="clockDate">Memuat tanggal...</div>
  </div>
  <div class="card-icon">🪪</div>
  <h1>Tap Kartu Anda</h1>
  <p class="sub">${subtitle} — tempelkan kartu atau ketik No. Kartu lalu Enter</p>
  <input type="text" inputmode="numeric" class="nis-input" id="nisInput" placeholder="• • • • • •" autofocus autocomplete="off">
  <p class="hint">Jendela ini bisa dibiarkan terbuka untuk siswa berikutnya</p>

  <div class="overlay" id="overlay">
    <div class="check-circle" id="checkCircle">
      <svg viewBox="0 0 24 24" fill="none" id="checkIcon"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <div class="overlay-nama" id="overlayNama"></div>
    <div class="overlay-text" id="overlayText"></div>
    <div class="overlay-status" id="overlayStatus"></div>
    <div class="overlay-sub">Siap untuk siswa berikutnya...</div>
  </div>
  </div>

<script>
  // Jam ditampilkan mengikuti waktu SERVER (bukan jam device) -- offset dihitung
  // sekali oleh parent lewat getServerTime() sebelum popup ini dibuka, lalu
  // dipakai buat mengoreksi jam device tiap detik tanpa perlu tanya server lagi.
  const serverOffsetMs = ${serverOffsetMs || 0};
  const namaHari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const namaBulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const clockTimeEl = document.getElementById('clockTime');
  const clockDateEl = document.getElementById('clockDate');
  const pad2 = n => String(n).padStart(2, '0');

  function updateClock() {
    const now = new Date(Date.now() + serverOffsetMs);
    clockTimeEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    clockDateEl.textContent = namaHari[now.getDay()] + ', ' + now.getDate() + ' ' + namaBulan[now.getMonth()] + ' ' + now.getFullYear();
  }
  updateClock();
  setInterval(updateClock, 1000);

  const input = document.getElementById('nisInput');
  const overlay = document.getElementById('overlay');
  const checkCircle = document.getElementById('checkCircle');
  const checkIcon = document.getElementById('checkIcon');
  const overlayNama = document.getElementById('overlayNama');
  const overlayText = document.getElementById('overlayText');
  const overlayStatus = document.getElementById('overlayStatus');
  let overlayTimer = null;

  input.focus();
  window.addEventListener('click', () => input.focus());

  function kirimNis() {
    const nis = input.value.trim();
    if (!nis) return;
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: '${messageType}', nis: nis, ts: Date.now() }, '*');
      }
    } catch (e) {}
    input.value = '';
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') kirimNis(); });

  // tipe: 'success' | 'duplicate' | 'error'
  function tampilkanOverlay(tipe, nama, statusText) {
    clearTimeout(overlayTimer);
    checkCircle.className = 'check-circle' + (tipe === 'error' ? ' error' : tipe === 'duplicate' ? ' duplicate' : '');
    checkIcon.innerHTML = tipe === 'error'
      ? '<path d="M6 6l12 12M18 6L6 18" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
      : '<path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';

    if (tipe === 'error') {
      overlayNama.textContent = '';
      overlayText.textContent = statusText || 'Gagal presensi';
      overlayStatus.style.display = 'none';
    } else if (tipe === 'duplicate') {
      overlayNama.textContent = nama || 'Siswa';
      overlayText.textContent = 'Sudah Presensi';
      overlayStatus.style.display = 'none';
    } else {
      overlayNama.textContent = nama || 'Siswa';
      overlayText.textContent = 'Presensi Berhasil';
      if (statusText) { overlayStatus.textContent = statusText; overlayStatus.style.display = 'inline-block'; }
      else { overlayStatus.style.display = 'none'; }
    }

    overlay.classList.add('show');
    overlayTimer = setTimeout(() => {
      overlay.classList.remove('show');
      input.value = '';
      input.focus();
    }, 3000);
  }

  window.addEventListener('message', (event) => {
    const d = event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'DH_SCAN_SUCCESS' || d.type === 'SHOLAT_SCAN_SUCCESS') {
      tampilkanOverlay('success', d.nama, d.status || '');
    } else if (d.type === 'DH_SCAN_DUPLICATE' || d.type === 'SHOLAT_SCAN_DUPLICATE') {
      tampilkanOverlay('duplicate', d.nama, '');
    } else if (d.type === 'DH_SCAN_ERROR' || d.type === 'SHOLAT_SCAN_ERROR') {
      tampilkanOverlay('error', '', d.message || 'Gagal presensi');
    }
  });
<\/script>
</body>
</html>`;
}

// Fungsi lama (stub agar tidak error jika masih dipanggil)
function dhToggleCamera() { dhOpenCameraPopup(); }
function dhStartCamera()  {}
function dhStopCamera()   { dhStopPopup(); }
function dhSwitchCam()    {}
function dhToggleTorch()  {}

// dhBeginScan tidak lagi digunakan (diganti sistem popup)
function dhBeginScan(video, canvas) {}

// dhOnDetected tidak lagi digunakan (kamera sudah di popup), tapi tetap ada sebagai stub
function dhOnDetected(text) {
    if (!text || (Date.now() - dhLastScan) < 1500) return;
    dhLastScan = Date.now();
    dhOnScanResult(text.trim());
}

// -- Suara notifikasi scan --
function dhPlayBeep(type = 'success') {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (type === 'success') {
            // Dua nada naik: bip bip ✅
            [0, 0.15].forEach((delay, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(i === 0 ? 880 : 1100, ctx.currentTime + delay);
                gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
                osc.start(ctx.currentTime + delay);
                osc.stop(ctx.currentTime + delay + 0.18);
            });
        } else {
            // Satu nada rendah pendek: bup ❌
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            gain.gain.setValueAtTime(0.35, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.25);
        }
    } catch(e) { /* AudioContext tidak didukung, abaikan */ }
}

var dhLastScannedNis = null;

function dhOnScanResult(rawKode) {
    const kodeKartu = String(rawKode).replace(/[^a-zA-Z0-9]/g,'').trim();
    const notif = document.getElementById('dhScanNotif');

    // Cari siswa di daftar -- cocokkan ke No. Kartu (bukan NIS lagi)
    const siswa = dhStudents.find(s => s.noKartu && s.noKartu === kodeKartu);
    if (!siswa) {
        dhPlayBeep('error');
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
        notif.textContent = '❌ No. Kartu [' + kodeKartu + '] tidak ada di kelas ini';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 3000);
        if (dhCameraPopup && !dhCameraPopup.closed) {
            try { dhCameraPopup.postMessage({ type: 'DH_SCAN_ERROR', message: 'No. Kartu tidak ada di kelas ini' }, '*'); } catch(e) {}
        }
        return;
    }
    const nis = siswa.nis; // NIS asli siswa, dipakai buat semua pencatatan di bawah

    // ── Mode Pulang ──
    if (dhMode === 'pulang') {
        dhOnPulangResult(nis, siswa.nama);
        return;
    }

    // ── Mode Masuk ──
    if (dhLockedMap[nis]) {
        // Siswa sudah absen sebelumnya, tidak bisa diubah
        dhPlayBeep('error');
        const lockedObj = dhLockedMap[nis];
        const st = (lockedObj && typeof lockedObj === 'object') ? lockedObj.status : String(lockedObj);
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-yellow-50 text-yellow-700 border border-yellow-100';
        notif.textContent = '🔒 ' + siswa.nama + ' sudah absen (' + st.charAt(0).toUpperCase() + st.slice(1) + ')';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        if (dhCameraPopup && !dhCameraPopup.closed) {
            try { dhCameraPopup.postMessage({ type: 'DH_SCAN_DUPLICATE', nama: siswa.nama }, '*'); } catch(e) {}
        }
        return;
    }

    const tanggalDh      = document.getElementById('dhTanggal').value;
    const kelasDropdownM = document.getElementById('dhKelasSelect').value;
    if (!tanggalDh || !kelasDropdownM) {
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-yellow-50 text-yellow-700 border border-yellow-100';
        notif.textContent = '⚠️ Pilih kelas dan tanggal terlebih dahulu';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        return;
    }

    dhLastScannedNis = nis;
    dhPlayBeep('success'); // Bunyi langsung saat scan valid — tidak menunggu server
    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-orange-50 text-orange-600 border border-orange-100';
    notif.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Menyimpan ' + siswa.nama + '...';
    notif.classList.remove('hidden');

    const kelasKirimM = (dhIsSemuaFilter(kelasDropdownM) && siswa) ? siswa.kelas : kelasDropdownM;
    // Jam ASLI saat scan tervalidasi -- dicatat DI SINI (bukan nanti pas request diproses server),
    // supaya kalau data ini sempat ketunda (disimpan offline), jam yang tersimpan tetap sama
    // dengan jam beneran siswa discan, bukan jam pas akhirnya sinkron.
    const jamAksiM = formatJamAksi();

    queueOfflineAction('Absen Masuk', 'submitDaftarHadirGuru', [
            [{ nis: nis, nama: siswa.nama, kelas: kelasKirimM, status: 'hadir', jamAksi: jamAksiM }],
            tanggalDh, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru'
        ], `${siswa.nama} (${kelasKirimM})`, 'direct-first')
        .then(outcome => {
            if (outcome.viaServer) {
                const res = outcome.result;
                if (res && res.success) {
                    dhLockedMap[nis] = { status: 'hadir', jamDatang: jamAksiM, hasJamDatang: true };
                    delete dhStatusMap[nis];
                    dhRenderStudentTable();

                    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
                    notif.textContent = '✅ ' + siswa.nama + ' — Hadir (tersimpan)';
                    notif.classList.remove('hidden');
                    setTimeout(() => notif.classList.add('hidden'), 1800);

                    if (dhCameraPopup && !dhCameraPopup.closed) {
                        try { dhCameraPopup.postMessage({ type: 'DH_SCAN_SUCCESS', nama: siswa.nama, status: 'Masuk' }, '*'); } catch(e) {}
                    }

                    const row = document.getElementById('dh-row-' + nis);
                    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else {
                    dhPlayBeep('error');
                    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
                    notif.textContent = '❌ ' + ((res && res.message) || 'Gagal menyimpan');
                    notif.classList.remove('hidden');
                    setTimeout(() => notif.classList.add('hidden'), 3000);
                    if (dhCameraPopup && !dhCameraPopup.closed) {
                        try { dhCameraPopup.postMessage({ type: 'DH_SCAN_ERROR', message: (res && res.message) || 'Gagal menyimpan' }, '*'); } catch(e) {}
                    }
                }
            } else {
                // Offline / server gak terjangkau -> kunci sementara di perangkat, beneran tersimpan setelah sinkron
                dhLockedMap[nis] = { status: 'hadir', jamDatang: jamAksiM, hasJamDatang: true };
                delete dhStatusMap[nis];
                dhRenderStudentTable();

                notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-amber-50 text-amber-600 border border-amber-100';
                notif.textContent = '📥 ' + siswa.nama + ' tersimpan di perangkat (menunggu Sinkron)';
                notif.classList.remove('hidden');
                setTimeout(() => notif.classList.add('hidden'), 2500);

                if (dhCameraPopup && !dhCameraPopup.closed) {
                    try { dhCameraPopup.postMessage({ type: 'DH_SCAN_SUCCESS', nama: siswa.nama, status: 'Masuk' }, '*'); } catch(e) {}
                }
            }
        });
}

// -- Handler scan pulang --
function dhOnPulangResult(nis, nama) {
    const notif  = document.getElementById('dhScanNotif');
    const kelasDropdown = document.getElementById('dhKelasSelect').value;
    const tanggal= document.getElementById('dhTanggal').value;
    if (!kelasDropdown || !tanggal) {
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-yellow-50 text-yellow-700 border border-yellow-100';
        notif.textContent = '⚠️ Pilih kelas dan tanggal terlebih dahulu';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        return;
    }
    // Gunakan kelas aktual siswa jika mode Semua Kelas
    const siswaData = dhStudents.find(s => s.nis === nis);
    const kelas = (dhIsSemuaFilter(kelasDropdown) && siswaData) ? siswaData.kelas : kelasDropdown;

    // Cek sudah pulang di data lokal
    const d = dhPulangMap[nis];
    if (d && d.jamPulang && d.jamPulang.trim()) {
        dhPlayBeep('error');
        notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-yellow-50 text-yellow-700 border border-yellow-100';
        notif.textContent = '⚠️ ' + (nama||nis) + ' sudah pulang (' + d.jamPulang + ')';
        notif.classList.remove('hidden');
        setTimeout(() => notif.classList.add('hidden'), 2500);
        if (dhCameraPopup && !dhCameraPopup.closed) {
            try { dhCameraPopup.postMessage({ type: 'DH_SCAN_DUPLICATE', nama: nama||nis }, '*'); } catch(e) {}
        }
        return;
    }

    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-orange-50 text-orange-600 border border-orange-100';
    notif.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Mencatat pulang ' + (nama||nis) + '...';
    notif.classList.remove('hidden');
    dhPlayBeep('success'); // Bunyi langsung saat scan valid — tidak menunggu server
    // Jam ASLI saat scan tervalidasi (lihat penjelasan formatJamAksi)
    const jamAksiP = formatJamAksi();

    queueOfflineAction('Absen Pulang', 'submitPulangSatu', [
            nis, kelas, tanggal, currentUser ? (currentUser.nama || currentUser.username || 'Guru') : 'Guru', jamAksiP
        ], `${nama || nis} (${kelas})`, 'direct-first')
        .then(outcome => {
            if (outcome.viaServer) {
                const res = outcome.result;
                if (res.success) {
                    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-emerald-50 text-emerald-700 border border-emerald-100';
                    notif.textContent = '✅ ' + res.nama + ' pulang — ' + res.jamPulang;
                    // Update lokal agar baris langsung berubah tanpa reload penuh
                    if (dhPulangMap[nis]) {
                        dhPulangMap[nis].jamPulang = res.jamPulang;
                        dhPulangMap[nis].checked   = false;
                    } else {
                        dhPulangMap[nis] = { jamPulang: res.jamPulang, checked: false };
                    }
                    dhRenderPulangTable();
                    // Feedback ke popup scanner
                    if (dhCameraPopup && !dhCameraPopup.closed) {
                        try { dhCameraPopup.postMessage({ type: 'DH_SCAN_SUCCESS', nama: res.nama, status: 'Pulang' }, '*'); } catch(e) {}
                    }
                } else {
                    dhPlayBeep('error');
                    notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-red-50 text-red-600 border border-red-100';
                    notif.textContent = '❌ ' + res.message;
                    if (dhCameraPopup && !dhCameraPopup.closed) {
                        try { dhCameraPopup.postMessage({ type: 'DH_SCAN_ERROR', message: res.message }, '*'); } catch(e) {}
                    }
                }
            } else {
                // Offline / server gak terjangkau -> tandai sementara di perangkat, beneran tersimpan setelah sinkron
                notif.className = 'rounded-xl p-3 text-sm font-semibold text-center bg-amber-50 text-amber-600 border border-amber-100';
                notif.textContent = '📥 ' + (nama || nis) + ' tersimpan di perangkat (menunggu Sinkron)';
                if (dhPulangMap[nis]) {
                    dhPulangMap[nis].jamPulang = jamAksiP;
                    dhPulangMap[nis].checked   = false;
                } else {
                    dhPulangMap[nis] = { jamPulang: jamAksiP, checked: false };
                }
                dhRenderPulangTable();
                if (dhCameraPopup && !dhCameraPopup.closed) {
                    try { dhCameraPopup.postMessage({ type: 'DH_SCAN_SUCCESS', nama: (nama || nis), status: 'Pulang' }, '*'); } catch(e) {}
                }
            }
            setTimeout(() => notif.classList.add('hidden'), 3000);
        });
}

// -- Input NIS Manual --
function dhSubmitManual() {
    const inp = document.getElementById('dhManualNis');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) { showAlert('error', 'Masukkan No. Kartu terlebih dahulu.'); return; }
    inp.value = '';
    dhOnScanResult(val);
}


function loadGuruDashboard() {
    stopAndBack(false);
    setActiveMenu('Dashboard');
    showView('view-guru-dashboard');
    
    document.getElementById('guruDashboardDate').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    // Kirim currentUser.kelas sebagai filter (bisa multi: "Kelas A,Kelas B")
    // Jika kosong (admin/guru umum), tampilkan semua
    const myClass = currentUser.role === 'guru' ? currentUser.kelas : null;
    const kelasLabel = myClass
        ? String(myClass).split(',').map(k => k.trim()).filter(Boolean).join(', ')
        : null;

    gas.run.withSuccessHandler(result => {
        if (result.success) {
            const data = result.data; 
            
            // Ubah judul jika filter aktif
            if (kelasLabel) {
                 document.querySelector('#view-guru-dashboard h2').textContent = `Dashboard Guru (${kelasLabel})`;
            }
            
            const totalSiswa = data.length;
            const sakit = data.filter(d => d.status === 'Sakit').length;
            const izin = data.filter(d => d.status === 'Izin').length;
            const alpa = data.filter(d => d.status === 'Alpa').length;
            const hadir = data.filter(d => d.status === 'Hadir').length;
            const belumAbsen = data.filter(d => d.status === 'Belum Absen').length;

            animateValue("statGuruTotal", 0, totalSiswa, 1000);
            animateValue("statGuruSakit", 0, sakit, 1000);
            animateValue("statGuruIzin", 0, izin, 1000);
            animateValue("statGuruAlpa", 0, alpa, 1000);
            renderGuruChart(hadir, sakit, izin, alpa, belumAbsen);
        }
    }).getMonitoringRealtime(myClass); // Pass Parameter (multi-kelas didukung)
}

    // Fungsi Render Chart Guru
    function renderGuruChart(hadir, sakit, izin, alpa, belumAbsen) {
        const ctx = document.getElementById('guruAttendanceChart');
        if (!ctx) return;

        // Hapus chart lama jika ada (mencegah glitch overlap)
        if (guruChartInstance) {
            guruChartInstance.destroy();
        }

        if (typeof ChartDataLabels !== 'undefined') { Chart.register(ChartDataLabels); }

        guruChartInstance = new Chart(ctx, {
            type: 'bar', // Diagram Batang
            data: {
                labels: ['Hadir', 'Sakit', 'Izin', 'Alpa', 'Belum Absen'],
                datasets: [{
                    label: 'Jumlah Siswa',
                    data: [hadir, sakit, izin, alpa, belumAbsen],
                    backgroundColor: [
                        '#10B981', // Hadir (Green)
                        '#F59E0B', // Sakit (Yellow)
                        '#3B82F6', // Izin (Blue)
                        '#EF4444', // Alpa (Red)
                        '#9CA3AF'  // Belum Absen (Gray)
                    ],
                    borderRadius: 6,
                    barPercentage: 0.6,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }, // Sembunyikan legenda default
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        formatter: (value) => value > 0 ? value : '', // Hanya tampilkan label jika > 0
                        font: { weight: 'bold', size: 11 },
                        color: '#4B5563'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { borderDash: [2, 4], color: '#F3F4F6' },
                        ticks: { stepSize: 1 }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // Helper: Animasi Angka (Counter Up)
    function animateValue(id, start, end, duration) {
        const obj = document.getElementById(id);
        if(!obj) return;
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start);
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }

    // --- SISWA DASHBOARD (DENGAN CEK LIBUR) ---
    function loadSiswaDashboard() {
        stopAndBack(false);
        setActiveMenu('Dashboard');
        showView('view-siswa-dashboard');
        showLoading();

        try {
            const safeSetText = (id, text) => {
                const el = document.getElementById(id);
                if (el) el.textContent = text;
            };

            if (currentUser) {
                const firstName = currentUser.nama ? currentUser.nama.split(' ')[0] : 'Siswa';
                safeSetText('dashGreeting', firstName);
                safeSetText('profileNameSidebar', currentUser.nama);
                safeSetText('profileNisSidebar', currentUser.nis);
                safeSetText('profileKelasSidebar', currentUser.kelas);
            }
            const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            safeSetText('dashDate', today);

            // Muat total point pelanggaran siswa (tidak tergantung status libur/presensi)
            loadDashboardPelanggaran();
        } catch (e) {}

        gas.run.withSuccessHandler(result => {
            hideLoading();
            try {
                const presensi = result && result.success ? result.data : null;
                const isLibur = result.isLibur; // Status libur dari server
                const infoLibur = result.keteranganLibur;

                const elHero = document.getElementById('heroCard');
                const elBadge = document.getElementById('dashStatusBadge');
                const elValMasuk = document.getElementById('valMasuk');
                const elValPulang = document.getElementById('valPulang');
                const elAlert = document.getElementById('alertBelumAbsen');

                // 1. MODE HARI LIBUR
                if (isLibur) {
                    if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-600 to-red-800 p-6 text-white shadow-xl shadow-rose-200 transition-all duration-500 group";
                    
                    if (elBadge) {
                        elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                        elBadge.innerHTML = `<i class="fas fa-calendar-times mr-2"></i> HARI LIBUR`;
                    }
                    
                    if (elValMasuk) {
                        elValMasuk.parentElement.innerHTML = `
                            <div class="text-center py-2">
                                <i class="fas fa-mug-hot text-3xl mb-2 opacity-80"></i>
                                <p class="text-sm font-bold uppercase tracking-widest">${infoLibur}</p>
                                <p class="text-[10px] mt-1 opacity-75">Tidak ada presensi hari ini</p>
                            </div>
                        `;
                        if(elValPulang) elValPulang.parentElement.style.display = 'none';
                        if(elValMasuk) elValMasuk.parentElement.classList.add('col-span-2');
                    }

                    if (elAlert) { elAlert.classList.add('hidden'); elAlert.classList.remove('flex'); }
                    loadDashboardSholatDzuhur(true, infoLibur);
                    return; 
                }

                // 2. MODE NORMAL (TIDAK LIBUR)
                // (Note: Idealnya kita reset style elValMasuk di sini jika aplikasi SPA kompleks)
                
                if (!presensi) {
                    if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-slate-800 p-6 text-white shadow-xl shadow-slate-200 transition-all duration-500 group";
                    if (elBadge) {
                        elBadge.className = "px-4 py-2 rounded-xl bg-rose-500/20 backdrop-blur-md border border-rose-500/30 text-rose-200 text-xs font-bold shadow-sm animate-pulse";
                        elBadge.innerHTML = `<i class="fas fa-circle text-[8px] mr-2"></i> BELUM ABSEN`;
                    }
                    if (elValMasuk) elValMasuk.textContent = "--:--";
                    if (elValPulang) elValPulang.textContent = "--:--";
                    if (elAlert) { elAlert.classList.remove('hidden'); elAlert.classList.add('flex'); }
                } else {
                    if (elAlert) { elAlert.classList.add('hidden'); elAlert.classList.remove('flex'); }
                    if (elValMasuk) elValMasuk.textContent = presensi.jamDatang || "--:--";
                    
                    if (!presensi.jamPulang) {
                        if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-800 p-6 text-white shadow-xl shadow-emerald-200 transition-all duration-500 group";
                        if (elBadge) {
                            elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                            elBadge.innerHTML = `<i class="fas fa-clock animate-pulse mr-2"></i> SEDANG BERLANGSUNG`;
                        }
                        if (elValPulang) elValPulang.textContent = "--:--";
                    } else {
                        if (elHero) elHero.className = "relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-800 p-6 text-white shadow-xl shadow-indigo-200 transition-all duration-500 group";
                        if (elBadge) {
                            elBadge.className = "px-4 py-2 rounded-xl bg-white/20 backdrop-blur-md border border-white/20 text-white text-xs font-bold shadow-sm";
                            elBadge.innerHTML = `<i class="fas fa-check-circle mr-2"></i> SELESAI HARI INI`;
                        }
                        if (elValPulang) elValPulang.textContent = presensi.jamPulang;
                    }
                }

                loadDashboardSholatDzuhur(false);
            } catch (err) { console.error("Error rendering dashboard:", err); }
        }).withFailureHandler(error => { hideLoading(); }).getPresensiToday(currentUser.nis);
    }

    function loadDashboardSholatDzuhur(isLibur, infoLibur) {
        const elKet   = document.getElementById('dashSholatKet');
        const elBadge = document.getElementById('dashSholatBadge');
        if (!elKet || !elBadge || !currentUser || !currentUser.nis) return;

        if (isLibur) {
            elKet.textContent = infoLibur || 'Hari libur';
            elBadge.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-500 flex-shrink-0 whitespace-nowrap';
            elBadge.innerHTML = '<i class="fas fa-calendar-times mr-1"></i> Libur';
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];

        gas.run
            .withSuccessHandler(res => {
                if (!res.success) {
                    elKet.textContent = 'Gagal memuat status';
                    return;
                }
                const rec = res.data;

                if (!rec) {
                    // Belum ada catatan sholat Dzuhur hari ini
                    elKet.textContent = 'Belum ada catatan dari guru/admin';
                    elBadge.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-500 flex-shrink-0 whitespace-nowrap';
                    elBadge.innerHTML = 'Belum Tercatat';
                    return;
                }

                if (rec.status === 'Hadir') {
                    elKet.textContent = (rec.keterangan || 'Mengikuti sholat berjamaah') + (rec.jamAbsen ? ' • ' + rec.jamAbsen : '');
                    elBadge.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-700 flex-shrink-0 whitespace-nowrap';
                    elBadge.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Hadir';
                } else if (rec.status === 'Tidak Hadir') {
                    elKet.textContent = rec.keterangan || 'Tidak mengikuti sholat';
                    elBadge.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-100 text-rose-700 flex-shrink-0 whitespace-nowrap';
                    elBadge.innerHTML = '<i class="fas fa-times-circle mr-1"></i> Tidak Hadir';
                } else if (rec.status === 'Izin / Uzur') {
                    elKet.textContent = rec.keterangan || 'Ada keterangan khusus';
                    elBadge.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-100 text-blue-700 flex-shrink-0 whitespace-nowrap';
                    elBadge.innerHTML = '<i class="fas fa-info-circle mr-1"></i> Izin';
                } else {
                    elKet.textContent = rec.keterangan || 'Status belum jelas';
                    elBadge.className = 'px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-500 flex-shrink-0 whitespace-nowrap';
                    elBadge.innerHTML = rec.status || '-';
                }
            })
            .withFailureHandler(() => {
                elKet.textContent = 'Gagal memuat status';
            })
            .getPresensiSholatSiswa(currentUser.nis, todayStr, 'Dzuhur');
    }

    function loadDashboardPelanggaran() {
        const iconWrap = document.getElementById('dashPelanggaranIconWrap');
        const textEl = document.getElementById('dashPelanggaranText');
        const boxEl = document.getElementById('dashPelanggaranBox');
        if (!textEl || !boxEl || !currentUser || !currentUser.nis) return;

        gas.run
            .withSuccessHandler(res => {
                if (!res || !res.success) {
                    textEl.textContent = 'Gagal memuat data pelanggaran';
                    return;
                }

                const totalPoint = res.totalPoint || 0;

                if (totalPoint <= 0) {
                    // Tidak memiliki point pelanggaran
                    boxEl.className = 'rounded-2xl shadow-sm border p-4 aspect-square flex flex-col items-center justify-center text-center gap-1.5 transition-all duration-500 bg-emerald-50 border-emerald-100 cursor-pointer hover:shadow-md hover:-translate-y-0.5';
                    if (iconWrap) iconWrap.className = 'w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center text-xl flex-shrink-0';
                    if (iconWrap) iconWrap.innerHTML = '<i class="fas fa-medal text-white"></i>';
                    textEl.className = 'text-xs font-bold text-emerald-700 truncate max-w-full';
                    textEl.textContent = 'Anda Anak Baik!';
                } else {
                    // Memiliki point pelanggaran
                    boxEl.className = 'rounded-2xl shadow-sm border p-4 aspect-square flex flex-col items-center justify-center text-center gap-1.5 transition-all duration-500 bg-rose-50 border-rose-100 cursor-pointer hover:shadow-md hover:-translate-y-0.5';
                    if (iconWrap) iconWrap.className = 'w-11 h-11 rounded-xl bg-rose-500 flex items-center justify-center text-xl flex-shrink-0';
                    if (iconWrap) iconWrap.innerHTML = '<i class="fas fa-exclamation-triangle text-white"></i>';
                    textEl.className = 'text-xs font-bold text-rose-700 truncate max-w-full';
                    textEl.textContent = `${totalPoint} Point - Klik detail`;
                }
            })
            .withFailureHandler(() => {
                textEl.textContent = 'Gagal memuat data pelanggaran';
            })
            .getTotalPelanggaranSiswa(currentUser.nis);
    }

    function showDetailPelanggaranSaya() {
        if (!currentUser || !currentUser.nis) return;

        showModal(`
            <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-lg w-full">
                <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <h3 class="text-xl font-bold text-gray-800"><i class="fas fa-shield-alt text-rose-500 mr-2"></i>Detail Point Pelanggaran</h3>
                    <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
                </div>
                <div id="dpsBody" class="p-6 max-h-[75vh] overflow-y-auto">
                    <div class="text-center py-10 text-gray-400"><i class="fas fa-circle-notch fa-spin text-2xl mb-3 block"></i>Memuat detail...</div>
                </div>
            </div>
        `);

        const token = currentUser.token;
        gas.run
            .withSuccessHandler(res => {
                const body = document.getElementById('dpsBody');
                if (!body) return; // modal sudah ditutup
                if (res.success) {
                    body.innerHTML = renderDetailPelanggaranSayaContent(res);
                } else {
                    body.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">${res.message}</div>`;
                }
            })
            .withFailureHandler(err => {
                const body = document.getElementById('dpsBody');
                if (body) body.innerHTML = `<div class="text-center py-10 text-red-500">Gagal koneksi: ${err}</div>`;
            })
            .getDetailPelanggaranSiswa(token, currentUser.nis);
    }

    function renderDetailPelanggaranSayaContent(res) {
        const s = res.siswa;
        const riwayat = res.riwayat || [];

        if (riwayat.length === 0) {
            return `
                <div class="text-center py-10">
                    <i class="fas fa-medal text-4xl text-emerald-400 mb-3 block"></i>
                    <p class="text-sm text-gray-500">Belum ada catatan pelanggaran. Pertahankan ya!</p>
                </div>`;
        }

        return `
            <div class="mb-5 p-4 bg-rose-50 rounded-xl border border-rose-100 flex justify-between items-center">
                <div>
                    <p class="font-bold text-gray-800">${s.nama}</p>
                    <p class="text-xs text-gray-500">NIS: ${s.nis} &bull; Kelas: ${s.kelas}</p>
                </div>
                <div class="text-right">
                    <p class="text-[10px] text-gray-400 uppercase font-bold">Total Point</p>
                    <p class="text-2xl font-bold text-rose-600">${s.totalPoint}</p>
                </div>
            </div>

            <div class="space-y-2">
                ${riwayat.map(r => `
                    <div class="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">${r.kodePelanggaran}</span>
                                <span class="text-[10px] text-gray-400">${r.tanggal}</span>
                            </div>
                            <p class="text-xs text-gray-700 mt-1">${r.jenisPelanggaran}</p>
                        </div>
                        <span class="text-sm font-bold text-red-600 whitespace-nowrap">${r.point} pt</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ==========================================================================
    // PROFIL SAYA (Dashboard Siswa -> Menu "Profil Saya")
    // ==========================================================================
    function loadProfilSiswa() {
        setActiveMenu('Profil Saya');
        showView('view-profil-siswa');

        if (!currentUser || !currentUser.nis) return;
        const token = currentUser.token;

        document.getElementById('profilSiswaLoading').classList.remove('hidden');
        document.getElementById('profilSiswaContent').classList.add('hidden');

        gas.run
            .withSuccessHandler(res => {
                document.getElementById('profilSiswaLoading').classList.add('hidden');
                if (!res.success) {
                    Swal.fire('Gagal', res.message, 'error');
                    return;
                }
                const d = res.data;
                document.getElementById('profilSiswaNama').textContent = d.namaLengkap || '-';
                document.getElementById('profilSiswaNama2').textContent = d.namaLengkap || '-';
                document.getElementById('profilSiswaNis').textContent = d.nis || '-';
                document.getElementById('profilSiswaKelas').textContent = d.kelas || '-';
                document.getElementById('profilSiswaJK').textContent = d.jenisKelamin || '-';
                document.getElementById('profilSiswaTglLahir').textContent = d.tanggalLahir || '-';
                document.getElementById('profilSiswaAlamat').textContent = d.alamat || '-';
                const avatarEl = document.getElementById('profilSiswaAvatar');
                if (d.foto) {
                    avatarEl.innerHTML = '<img src="' + d.foto + '" alt="Foto" class="w-full h-full object-cover rounded-xl" onerror="this.parentElement.textContent = (\'' + (d.namaLengkap || '?').trim().charAt(0).toUpperCase() + '\');">';
                } else {
                    avatarEl.textContent = (d.namaLengkap || '?').trim().charAt(0).toUpperCase();
                }
                document.getElementById('profilSiswaContent').classList.remove('hidden');
            })
            .withFailureHandler(err => {
                document.getElementById('profilSiswaLoading').classList.add('hidden');
                Swal.fire('Error', String(err), 'error');
            })
            .getProfilSiswa(token, currentUser.nis);
    }

    function unduhSuratKartuPelajar(btnEl) {
        if (!currentUser || !currentUser.nis) return;
        const token = currentUser.token;
        const originalHtml = btnEl ? btnEl.innerHTML : null;
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Membuat PDF...';
        }

        gas.run
            .withSuccessHandler(res => {
                if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
                if (!res.success) {
                    Swal.fire('Gagal', res.message || 'Gagal membuat PDF.', 'error');
                    return;
                }
                try {
                    const byteChars = atob(res.base64);
                    const byteNumbers = new Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) {
                        byteNumbers[i] = byteChars.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = res.fileName || 'Permohonan_Kartu_Pelajar.pdf';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } catch (e) {
                    Swal.fire('Error', 'Gagal membuka PDF: ' + e, 'error');
                }
            })
            .withFailureHandler(err => {
                if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
                Swal.fire('Error', String(err), 'error');
            })
            .cetakSuratPermohonanKartuPelajar(token, currentUser.nis);
    }

    // ==========================================================================
    // REKAP KEHADIRAN SISWA (Dashboard Siswa -> Menu "Rekap Kehadiran")
    // ==========================================================================
    let rekapKehadiranSiswaDetail = { Sakit: [], Izin: [], Alpa: [] };

    function loadRekapKehadiranSiswa() {
        setActiveMenu('Rekap Kehadiran');
        showView('view-rekap-kehadiran-siswa');

        // Default rentang: tanggal 1 bulan ini s/d hari ini
        const today = new Date();
        const firstDayMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const toStr = d => d.toISOString().split('T')[0];

        document.getElementById('rekapSiswaTglMulai').value = toStr(firstDayMonth);
        document.getElementById('rekapSiswaTglAkhir').value = toStr(today);

        fetchRekapKehadiranSiswa();
    }

    function fetchRekapKehadiranSiswa() {
        const mulai = document.getElementById('rekapSiswaTglMulai').value;
        const akhir = document.getElementById('rekapSiswaTglAkhir').value;

        if (!mulai || !akhir) {
            Swal.fire('Perhatian', 'Pilih rentang tanggal terlebih dahulu.', 'warning');
            return;
        }
        if (!currentUser || !currentUser.nis) return;

        document.getElementById('rekapSiswaInfoText').textContent = 'Memuat data...';
        ['rekapSiswaHadir','rekapSiswaSakit','rekapSiswaIzin','rekapSiswaAlpa'].forEach(id => {
            document.getElementById(id).textContent = '…';
        });

        gas.run
            .withSuccessHandler(res => {
                if (!res.success) {
                    Swal.fire('Gagal', res.message, 'error');
                    document.getElementById('rekapSiswaInfoText').textContent = '';
                    return;
                }
                const stats  = res.data.stats;
                const detail = res.data.detail;

                document.getElementById('rekapSiswaHadir').textContent = stats.hadir;
                document.getElementById('rekapSiswaSakit').textContent = stats.sakit;
                document.getElementById('rekapSiswaIzin').textContent  = stats.izin;
                document.getElementById('rekapSiswaAlpa').textContent  = stats.alpa;

                rekapKehadiranSiswaDetail = detail;

                const persen = stats.totalHariEfektif > 0
                    ? Math.round((stats.hadir / stats.totalHariEfektif) * 100)
                    : 0;
                document.getElementById('rekapSiswaInfoText').textContent =
                    `${stats.totalHariEfektif} hari efektif — persentase kehadiran ${persen}%`;
            })
            .withFailureHandler(err => {
                Swal.fire('Error', String(err), 'error');
                document.getElementById('rekapSiswaInfoText').textContent = '';
            })
            .getRekapKehadiranSiswa(currentUser.nis, mulai, akhir);
    }

    function showDetailKehadiranSiswa(status) {
        const list = rekapKehadiranSiswaDetail[status] || [];
        const cfgMap = {
            Sakit: { badge: 'bg-amber-100 text-amber-700', icon: 'fa-briefcase-medical', title: 'Riwayat Sakit' },
            Izin:  { badge: 'bg-blue-100 text-blue-700',   icon: 'fa-file-alt',          title: 'Riwayat Izin' },
            Alpa:  { badge: 'bg-rose-100 text-rose-700',   icon: 'fa-times',             title: 'Riwayat Alpa' }
        };
        const cfg = cfgMap[status] || cfgMap.Alpa;

        const rows = list.length
            ? list.map(d => `
                <tr class="border-b border-gray-100">
                    <td class="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">${formatTanggalIndoSiswa(d.tanggal)}</td>
                    <td class="px-4 py-2.5 text-xs text-gray-500">${d.keterangan || '-'}</td>
                </tr>`).join('')
            : `<tr><td colspan="2" class="px-4 py-10 text-center text-xs text-gray-400">Tidak ada catatan ${status.toLowerCase()} pada rentang tanggal ini. 🎉</td></tr>`;

        showModal(`
            <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
                <div class="p-5 border-b border-gray-100 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl ${cfg.badge} flex items-center justify-center">
                            <i class="fas ${cfg.icon}"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-sm text-gray-800">${cfg.title}</h3>
                            <p class="text-[10px] text-gray-400">${list.length} tanggal tercatat</p>
                        </div>
                    </div>
                    <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="max-h-[60vh] overflow-y-auto">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50 sticky top-0">
                            <tr>
                                <th class="px-4 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">Tanggal</th>
                                <th class="px-4 py-2 text-left text-[10px] font-bold text-gray-400 uppercase">Keterangan</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div class="p-4 border-t border-gray-100 text-right">
                    <button onclick="closeModal()" class="text-xs font-bold text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 transition">Tutup</button>
                </div>
            </div>
        `);
    }

    function formatTanggalIndoSiswa(tglStr) {
        try {
            const d = new Date(tglStr + 'T00:00:00');
            return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) { return tglStr; }
    }

    // --- KELOLA HARI LIBUR (ADMIN) ---
// --- KELOLA WAKTU & HARI LIBUR (ADMIN) ---

// ====================================================
// MANAJEMEN KELAS
// ====================================================
let mkAllKelas = []; // cache semua kelas

function loadManajemenKelas() {
    setActiveMenu('Manajemen Kelas');
    showView('view-manajemen-kelas');
    mkLoadKelas();
}

function mkLoadKelas() {
    const list = document.getElementById('mkKelasList');
    list.innerHTML = '<div class="text-center py-10 text-gray-400"><i class="fas fa-circle-notch fa-spin text-2xl mb-3 block"></i><p class="text-sm">Memuat data kelas...</p></div>';
    document.getElementById('mkTotalKelas').textContent = '—';
    document.getElementById('mkTotalSiswa').textContent = '— siswa terdaftar';

    gas.run
        .withSuccessHandler(res => {
            if (!res.success) { mkShowListError(res.message); return; }
            mkAllKelas = res.data || [];
            mkRenderList(mkAllKelas);
            document.getElementById('mkTotalKelas').textContent = mkAllKelas.length;
        })
        .withFailureHandler(err => mkShowListError(String(err)))
        .getKelasMaster();

    // Count siswa per kelas
    gas.run
        .withSuccessHandler(res => {
            if (res && res.success && res.data) {
                const total = res.data.length;
                document.getElementById('mkTotalSiswa').textContent = total + ' siswa terdaftar';
            }
        })
        .withFailureHandler(() => {})
        .getSiswaList(null);
}

function mkShowListError(msg) {
    document.getElementById('mkKelasList').innerHTML =
        `<div class="text-center py-10 text-red-400"><i class="fas fa-exclamation-circle text-2xl mb-2 block"></i><p class="text-sm">${msg}</p></div>`;
}

function mkFilterKelas() {
    const q = document.getElementById('mkSearchKelas').value.trim().toLowerCase();
    const filtered = q ? mkAllKelas.filter(k => k.nama.toLowerCase().includes(q)) : mkAllKelas;
    mkRenderList(filtered);
}

function mkRenderList(kelasList) {
    const list = document.getElementById('mkKelasList');
    if (!kelasList || kelasList.length === 0) {
        list.innerHTML = '<div class="text-center py-12 text-gray-400"><i class="fas fa-inbox text-3xl mb-3 block opacity-40"></i><p class="text-sm font-semibold">Belum ada kelas terdaftar</p><p class="text-xs mt-1">Tambahkan kelas baru menggunakan form di sebelah kiri.</p></div>';
        return;
    }
    list.innerHTML = kelasList.map((k, i) => {
        const initials = k.nama.substring(0, 2).toUpperCase();
        return `
        <div class="kelas-card" id="kelas-card-${k.rowIndex}">
          <div class="kelas-avatar">${initials}</div>
          <div class="flex-1 min-w-0">
            <div id="kelas-label-${k.rowIndex}" class="font-bold text-sm text-gray-800">${k.nama}</div>
            <input id="kelas-input-${k.rowIndex}" type="text" value="${k.nama}"
              class="kelas-input-edit hidden"
              onkeydown="if(event.key==='Enter') mkSimpanEdit(${k.rowIndex}); if(event.key==='Escape') mkBatalEdit(${k.rowIndex});">
            <div class="text-[10px] text-gray-400 mt-0.5">Kelas ke-${i + 1}</div>
          </div>
          <div class="flex items-center gap-1.5" id="kelas-actions-${k.rowIndex}">
            <button onclick="mkMulaiEdit(${k.rowIndex})"
              class="w-8 h-8 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 flex items-center justify-center transition text-sm" title="Edit">
              <i class="fas fa-pen text-xs"></i>
            </button>
            <button onclick="mkHapusKelas(${k.rowIndex}, '${k.nama.replace(/'/g, "\'")}')"
              class="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center transition text-sm" title="Hapus">
              <i class="fas fa-trash text-xs"></i>
            </button>
          </div>
          <div class="hidden items-center gap-1.5" id="kelas-edit-actions-${k.rowIndex}">
            <button onclick="mkSimpanEdit(${k.rowIndex})"
              class="w-8 h-8 rounded-lg bg-green-500 hover:bg-green-600 text-white flex items-center justify-center transition" title="Simpan">
              <i class="fas fa-check text-xs"></i>
            </button>
            <button onclick="mkBatalEdit(${k.rowIndex})"
              class="w-8 h-8 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center transition" title="Batal">
              <i class="fas fa-times text-xs"></i>
            </button>
          </div>
        </div>`;
    }).join('');
}

function mkMulaiEdit(rowIndex) {
    document.getElementById('kelas-label-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-input-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-actions-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.add('flex');
    const inp = document.getElementById('kelas-input-' + rowIndex);
    inp.focus(); inp.select();
}

function mkBatalEdit(rowIndex) {
    const k = mkAllKelas.find(x => x.rowIndex === rowIndex);
    if (k) document.getElementById('kelas-input-' + rowIndex).value = k.nama;
    document.getElementById('kelas-label-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-input-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-actions-' + rowIndex).classList.remove('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.add('hidden');
    document.getElementById('kelas-edit-actions-' + rowIndex).classList.remove('flex');
}

function mkSimpanEdit(rowIndex) {
    const namaBaru = document.getElementById('kelas-input-' + rowIndex).value.trim();
    if (!namaBaru) { showAlert('error', 'Nama kelas tidak boleh kosong.'); return; }
    showLoading();
    gas.run
        .withSuccessHandler(res => {
            hideLoading();
            if (res.success) {
                showAlert('success', res.message);
                mkLoadKelas();
            } else {
                showAlert('error', res.message);
                mkBatalEdit(rowIndex);
            }
        })
        .withFailureHandler(err => { hideLoading(); showAlert('error', String(err)); mkBatalEdit(rowIndex); })
        .updateKelas(rowIndex, namaBaru);
}

function mkHapusKelas(rowIndex, namaKelas) {
    Swal.fire({
        title: 'Hapus Kelas?',
        html: `<p class="text-gray-600 text-sm">Kelas <b>${namaKelas}</b> akan dihapus dari sistem.<br><span class="text-red-500 text-xs">Kelas tidak bisa dihapus jika masih ada siswa terdaftar.</span></p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Ya, Hapus',
        cancelButtonText: 'Batal'
    }).then(r => {
        if (!r.isConfirmed) return;
        showLoading();
        gas.run
            .withSuccessHandler(res => {
                hideLoading();
                if (res.success) { showAlert('success', res.message); mkLoadKelas(); }
                else Swal.fire('Gagal', res.message, 'error');
            })
            .withFailureHandler(err => { hideLoading(); showAlert('error', String(err)); })
            .deleteKelas(rowIndex, namaKelas);
    });
}

function mkTambahKelas() {
    const inp = document.getElementById('inputNamaKelas');
    const nama = inp.value.trim();
    if (!nama) { inp.focus(); showAlert('error', 'Masukkan nama kelas terlebih dahulu.'); return; }
    const btn = document.getElementById('btnTambahKelas');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';
    gas.run
        .withSuccessHandler(res => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Tambah Kelas';
            if (res.success) {
                showAlert('success', res.message);
                inp.value = '';
                mkLoadKelas();
            } else {
                showAlert('error', res.message);
            }
        })
        .withFailureHandler(err => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus-circle"></i> Tambah Kelas';
            showAlert('error', String(err));
        })
        .addKelas(nama);
}

// ==========================================================================
// MANAJEMEN PELANGGARAN (ADMIN) - Master Data: Kode, Jenis, Point
// ==========================================================================
function loadManajemenPelanggaran() {
    stopAndBack(false);
    setActiveMenu('Manajemen Pelanggaran');
    showView('view-manajemen-pelanggaran');
    mpLoadList();
}

function mpLoadList() {
    const tbody = document.getElementById('mpTbody');
    tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';

    const token = currentUser ? currentUser.token : null;

    gas.run
        .withSuccessHandler(res => {
            if (res.success) {
                mpAllData = res.data || [];
                mpRenderRows(mpAllData);
            } else {
                tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${res.message}</td></tr>`;
            }
        })
        .withFailureHandler(err => {
            tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-500">Gagal koneksi: ${err}</td></tr>`;
        })
        .getMasterPelanggaranList(token);
}

function mpFilterList() {
    const q = document.getElementById('mpSearchInput').value.trim().toLowerCase();
    const filtered = q
        ? mpAllData.filter(p => String(p.kode).toLowerCase().includes(q) || String(p.jenis).toLowerCase().includes(q))
        : mpAllData;
    mpRenderRows(filtered);
}

function mpRenderRows(list) {
    const tbody = document.getElementById('mpTbody');
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400"><i class="fas fa-inbox text-2xl mb-2 block opacity-40"></i>Belum ada data pelanggaran.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map(p => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-50">
            <td class="p-3"><span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">${p.kode}</span></td>
            <td class="p-3 text-sm text-gray-700">${p.jenis}</td>
            <td class="p-3 text-center text-sm font-bold text-gray-800">${p.point}</td>
            <td class="p-3 text-center">
                <div class="flex justify-center space-x-2">
                    <button onclick='showEditPelanggaranMasterModal(${JSON.stringify(p)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteMasterPelanggaranConfirm('${String(p.kode).replace(/'/g, "\\'")}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`).join('');
}

function showAddPelanggaranMasterModal() {
    showModal(createPelanggaranMasterModal(null));
}

function showEditPelanggaranMasterModal(p) {
    showModal(createPelanggaranMasterModal(p));
}

function createPelanggaranMasterModal(p) {
    const isEdit = !!p;
    const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5 transition-all";
    const labelClass = "block mb-1 text-xs font-bold text-gray-500 uppercase tracking-wide";

    return `
    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-lg w-full animate-fade-in">
        <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h3 class="text-xl font-bold text-gray-800"><i class="fas fa-exclamation-circle text-red-500 mr-2"></i>${isEdit ? 'Edit' : 'Tambah'} Data Pelanggaran</h3>
            <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
        </div>
        <div class="p-6">
            <form onsubmit="saveMasterPelanggaran(event, ${isEdit})" class="space-y-5">
                <div class="grid grid-cols-2 gap-5">
                    <div>
                        <label class="${labelClass}">Kode Pelanggaran</label>
                        <input type="text" name="kode" value="${p?.kode || ''}" required class="${inputClass}" placeholder="Contoh: A-01">
                    </div>
                    <div>
                        <label class="${labelClass}">Point</label>
                        <input type="number" name="point" value="${p?.point ?? ''}" required min="0" class="${inputClass}" placeholder="Contoh: 10">
                    </div>
                </div>
                <div>
                    <label class="${labelClass}">Jenis Pelanggaran</label>
                    <textarea name="jenis" rows="2" required class="${inputClass}" placeholder="Contoh: Terlambat masuk sekolah">${p?.jenis || ''}</textarea>
                </div>
                <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition">Batal</button>
                    <button type="submit" class="px-6 py-2.5 bg-red-600 text-white rounded-xl font-bold shadow-lg hover:bg-red-700 transition transform active:scale-95">Simpan</button>
                </div>
                ${isEdit ? `<input type="hidden" name="oldKode" value="${p.kode}">` : ''}
            </form>
        </div>
    </div>`;
}

function saveMasterPelanggaran(e, isEdit) {
    e.preventDefault();
    showLoading();

    const fd = new FormData(e.target);
    const data = {
        kode: fd.get('kode').trim(),
        jenis: fd.get('jenis').trim(),
        point: fd.get('point')
    };
    const token = currentUser ? currentUser.token : null;

    const callback = (res) => {
        hideLoading();
        if (res.success) {
            closeModal();
            showAlert('success', res.message);
            mpLoadList();
        } else {
            showAlert('error', res.message);
        }
    };
    const failCallback = (err) => {
        hideLoading();
        showAlert('error', String(err));
    };

    if (isEdit) {
        const oldKode = fd.get('oldKode');
        gas.run.withSuccessHandler(callback).withFailureHandler(failCallback).updateMasterPelanggaran(token, oldKode, data);
    } else {
        gas.run.withSuccessHandler(callback).withFailureHandler(failCallback).addMasterPelanggaran(token, data);
    }
}

function deleteMasterPelanggaranConfirm(kode) {
    if (confirm(`Hapus data pelanggaran kode: ${kode}?`)) {
        showLoading();
        const token = currentUser ? currentUser.token : null;
        gas.run
            .withSuccessHandler(res => {
                hideLoading();
                if (res.success) { showAlert('success', res.message); mpLoadList(); }
                else { showAlert('error', res.message); }
            })
            .withFailureHandler(err => { hideLoading(); showAlert('error', String(err)); })
            .deleteMasterPelanggaran(token, kode);
    }
}

// ==========================================================================
// MONITORING PELANGGARAN (GURU) - Rekap total point + status penyelesaian
// ==========================================================================
let mtAllData = []; // Cache rekap monitoring pelanggaran

function loadMonitoringPelanggaran() {
    stopAndBack(false);
    setActiveMenu('Monitoring Pelanggaran');
    showView('view-monitoring-pelanggaran');
    mtLoadList();
}

function mtLoadList() {
    const tbody = document.getElementById('mtTbody');
    tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-400"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';

    const token = currentUser ? currentUser.token : null;

    gas.run
        .withSuccessHandler(res => {
            if (res.success) {
                mtAllData = res.data || [];
                mtRenderRows(mtAllData);
            } else {
                tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${res.message}</td></tr>`;
            }
        })
        .withFailureHandler(err => {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500">Gagal koneksi: ${err}</td></tr>`;
        })
        .getMonitoringPelanggaranList(token);
}

function mtFilterList() {
    const q = document.getElementById('mtSearchInput').value.trim().toLowerCase();
    const range = document.getElementById('mtFilterPoint').value;

    let filtered = mtAllData;

    if (q) {
        filtered = filtered.filter(s => String(s.nama).toLowerCase().includes(q) || String(s.nis).toLowerCase().includes(q) || String(s.kelas).toLowerCase().includes(q));
    }

    if (range) {
        const [min, max] = range.split('-').map(Number);
        filtered = filtered.filter(s => Number(s.totalPoint) >= min && Number(s.totalPoint) <= max);
    }

    mtRenderRows(filtered);
}

function mtRenderRows(list) {
    const tbody = document.getElementById('mtTbody');
    if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-400"><i class="fas fa-inbox text-2xl mb-2 block opacity-40"></i>Belum ada data pelanggaran.</td></tr>';
        return;
    }
    tbody.innerHTML = list.map((s, idx) => {
        const selesai = s.keterangan === 'Sudah diselesaikan';
        const badge = selesai
            ? '<span class="bg-green-100 text-green-700 px-2 py-1 rounded-full text-[10px] font-bold">Sudah diselesaikan</span>'
            : '<span class="bg-red-100 text-red-700 px-2 py-1 rounded-full text-[10px] font-bold">Belum diselesaikan</span>';
        return `
        <tr class="hover:bg-gray-50 transition">
            <td class="p-3 text-center text-gray-400">${idx + 1}</td>
            <td class="p-3 font-medium text-gray-800">${s.nama}</td>
            <td class="p-3 hidden sm:table-cell">${s.kelas}</td>
            <td class="p-3 hidden md:table-cell">${s.nis}</td>
            <td class="p-3 text-center font-bold text-red-600">${s.totalPoint}</td>
            <td class="p-3 text-center">${badge}</td>
            <td class="p-3 text-center">
                <button onclick="showDetailPelanggaranModal('${String(s.nis).replace(/'/g, "\\'")}')" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition" title="Detail">
                    <i class="fas fa-eye"></i>
                </button>
                <button onclick="exportPelanggaranPDF('${String(s.nis).replace(/'/g, "\\'")}', this)" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition ml-1" title="Export PDF">
                    <i class="fas fa-file-pdf"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

/**
 * Export riwayat pelanggaran satu siswa menjadi PDF (sesuai template resmi sekolah)
 * lalu membukanya di tab baru sebagai preview sebelum guru mendownloadnya.
 */
function exportPelanggaranPDF(nis, btnEl) {
    const token = currentUser ? currentUser.token : null;
    const originalHtml = btnEl ? btnEl.innerHTML : null;
    if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
    }

    gas.run
        .withSuccessHandler(res => {
            if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
            if (!res.success) {
                showAlert('error', res.message || 'Gagal membuat PDF.');
                return;
            }
            try {
                const byteChars = atob(res.base64);
                const byteNumbers = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) {
                    byteNumbers[i] = byteChars.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');
            } catch (e) {
                showAlert('error', 'Gagal membuka PDF: ' + e);
            }
        })
        .withFailureHandler(err => {
            if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalHtml; }
            showAlert('error', 'Gagal koneksi: ' + err);
        })
        .exportPelanggaranPDF(token, nis);
}

function showDetailPelanggaranModal(nis) {
    showModal(`
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-800"><i class="fas fa-user-shield text-red-500 mr-2"></i>Detail Pelanggaran</h3>
                <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div id="mtDetailBody" class="p-6 max-h-[75vh] overflow-y-auto">
                <div class="text-center py-10 text-gray-400"><i class="fas fa-circle-notch fa-spin text-2xl mb-3 block"></i>Memuat detail...</div>
            </div>
        </div>
    `);

    const token = currentUser ? currentUser.token : null;
    gas.run
        .withSuccessHandler(res => {
            const body = document.getElementById('mtDetailBody');
            if (!body) return; // modal sudah ditutup
            if (res.success) {
                body.innerHTML = renderDetailPelanggaranContent(res);
            } else {
                body.innerHTML = `<div class="text-center py-10 text-red-500 font-bold">${res.message}</div>`;
            }
        })
        .withFailureHandler(err => {
            const body = document.getElementById('mtDetailBody');
            if (body) body.innerHTML = `<div class="text-center py-10 text-red-500">Gagal koneksi: ${err}</div>`;
        })
        .getDetailPelanggaranSiswa(token, nis);
}

function renderDetailPelanggaranContent(res) {
    const s = res.siswa;
    const riwayat = res.riwayat || [];
    const aksi = res.aksi || {};
    const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5 transition-all";
    const labelClass = "block mb-1 text-xs font-bold text-gray-500 uppercase tracking-wide";

    const riwayatHtml = riwayat.length === 0
        ? '<div class="text-center py-6 text-gray-400 text-sm">Belum ada riwayat pelanggaran.</div>'
        : `<div class="space-y-2 max-h-52 overflow-y-auto pr-1">
            ${riwayat.map(r => `
                <div class="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-[10px] font-bold">${r.kodePelanggaran}</span>
                            <span class="text-[10px] text-gray-400">${r.tanggal}</span>
                        </div>
                        <p class="text-xs text-gray-700 mt-1">${r.jenisPelanggaran}</p>
                    </div>
                    <span class="text-sm font-bold text-red-600 whitespace-nowrap">${r.point} pt</span>
                </div>
            `).join('')}
        </div>`;

    return `
        <div class="mb-5 p-4 bg-red-50 rounded-xl border border-red-100">
            <div class="flex justify-between items-center">
                <div>
                    <p class="font-bold text-gray-800">${s.nama}</p>
                    <p class="text-xs text-gray-500">NIS: ${s.nis} &bull; Kelas: ${s.kelas}</p>
                </div>
                <div class="text-right">
                    <p class="text-[10px] text-gray-400 uppercase font-bold">Total Point</p>
                    <p class="text-2xl font-bold text-red-600">${s.totalPoint}</p>
                </div>
            </div>
        </div>

        <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Riwayat Pelanggaran</h4>
        ${riwayatHtml}

        <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wide mt-6 mb-2">Aksi / Penyelesaian Masalah</h4>
        <form onsubmit="submitAksiPenyelesaian(event, '${String(s.nis).replace(/'/g, "\\'")}')" class="space-y-4">
            <div>
                <label class="${labelClass}">Aksi Ke-1</label>
                <textarea id="mtAksi1" rows="2" class="${inputClass}" placeholder="Contoh: Teguran lisan & panggil orang tua...">${aksi.aksi1 || ''}</textarea>
            </div>
            <div>
                <label class="${labelClass}">Aksi Ke-2</label>
                <textarea id="mtAksi2" rows="2" class="${inputClass}" placeholder="Diisi jika siswa melanggar lagi setelah Aksi Ke-1">${aksi.aksi2 || ''}</textarea>
            </div>
            <div>
                <label class="${labelClass}">Aksi Ke-3</label>
                <textarea id="mtAksi3" rows="2" class="${inputClass}" placeholder="Diisi jika siswa melanggar lagi setelah Aksi Ke-2">${aksi.aksi3 || ''}</textarea>
            </div>
            <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition">Tutup</button>
                <button type="submit" class="px-6 py-2.5 bg-red-600 text-white rounded-xl font-bold shadow-lg hover:bg-red-700 transition transform active:scale-95">Simpan Penyelesaian</button>
            </div>
        </form>
    `;
}

function submitAksiPenyelesaian(e, nis) {
    e.preventDefault();
    showLoading();

    const aksi1 = document.getElementById('mtAksi1').value.trim();
    const aksi2 = document.getElementById('mtAksi2').value.trim();
    const aksi3 = document.getElementById('mtAksi3').value.trim();
    const token = currentUser ? currentUser.token : null;

    gas.run
        .withSuccessHandler(res => {
            hideLoading();
            if (res.success) {
                closeModal();
                showAlert('success', res.message);
                mtLoadList();
            } else {
                showAlert('error', res.message);
            }
        })
        .withFailureHandler(err => {
            hideLoading();
            showAlert('error', String(err));
        })
        .saveAksiPenyelesaian(token, nis, aksi1, aksi2, aksi3);
}

    function loadKelolaAbsen() {
        stopAndBack(false);
        setActiveMenu('Kelola Absen');
        showView('view-kelola-absen');
        
        // 1. Load Data Hari Libur (Seperti Biasa)
        document.getElementById('tbody-libur').innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';
        
        gas.run.withSuccessHandler(result => {
            if (result.success) {
                tableState.libur.fullData = result.data;
                processTableData('libur');
            } else {
                document.getElementById('tbody-libur').innerHTML = '<tr><td colspan="4" class="p-4 text-center text-red-500">Gagal memuat data.</td></tr>';
            }
        }).getHariLibur();

        // 2. Load Data Konfigurasi Jam (BARU)
        loadGlobalConfig();
    }

    // ---- Data jadwal harian (state lokal) ----
    const HARI_NAMES = { '1':'Senin', '2':'Selasa', '3':'Rabu', '4':'Kamis', '5':'Jumat', '6':'Sabtu', '7':'Minggu' };
    const HARI_COLORS = { '1':'indigo', '2':'indigo', '3':'indigo', '4':'indigo', '5':'indigo', '6':'orange', '7':'red' };
    let _jadwalHarian = null;

    function renderJadwalHarian(jadwal) {
        _jadwalHarian = jadwal;
        const container = document.getElementById('jadwal-hari-container');
        if (!container) return;
        let html = '';
        for (let d = 1; d <= 7; d++) {
            const key = String(d);
            const hari = jadwal[key] || { libur: d===7, libur_rutinan: true, masuk_mulai:'06:00', masuk_akhir:'07:15', pulang_mulai:'15:00', pulang_akhir:'17:00', ket_libur:'' };
            const isLibur = !!hari.libur;
            // Default rutinan: jika libur_rutinan undefined (data lama), anggap rutinan=true
            const isRutinan = hari.libur_rutinan !== false;
            const ketLibur = hari.ket_libur || '';
            const col = HARI_COLORS[key];
            const colClass = isLibur ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
            const badgeClass = isLibur
                ? (isRutinan ? 'bg-purple-100 text-purple-600' : 'bg-red-100 text-red-600')
                : 'bg-green-100 text-green-700';
            const badgeText = isLibur
                ? (isRutinan ? '<i class=\"fas fa-redo mr-1\"></i>Libur Rutin' : '<i class=\"fas fa-star mr-1\"></i>Libur Khusus')
                : '<i class=\"fas fa-check-circle mr-1\"></i>Masuk';
            html += `
            <div class="rounded-lg border ${colClass} overflow-hidden" id="card-hari-${key}">
              <div class="flex items-center justify-between px-3 py-2 cursor-pointer" onclick="toggleHariExpand('${key}')">
                <span class="text-xs font-bold text-gray-700 flex items-center gap-2">
                  <i class="fas fa-calendar-day text-${col}-500 w-4"></i> ${HARI_NAMES[key]}
                </span>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass}" id="badge-${key}">${badgeText}</span>
                  <label class="relative inline-flex items-center cursor-pointer" onclick="event.stopPropagation()">
                    <input type="checkbox" class="sr-only peer" id="toggle-libur-${key}" ${isLibur ? '' : 'checked'}
                      onchange="onToggleMasuk('${key}', this.checked)">
                    <div class="w-9 h-5 bg-red-300 peer-checked:bg-green-400 rounded-full peer peer-checked:after:translate-x-full after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                  </label>
                </div>
              </div>
              <div id="ket-libur-wrap-${key}" class="${isLibur ? '' : 'hidden'} px-3 pb-2 pt-2 border-t border-red-100">
                <p class="text-[9px] uppercase font-bold text-red-400 mb-1.5"><i class="fas fa-tag mr-1"></i>Jenis Libur</p>
                <div class="flex gap-2 mb-1.5">
                  <label class="flex-1 flex items-center gap-1.5 cursor-pointer rounded-lg border px-2 py-1.5 text-[11px] font-semibold
                    ${isRutinan ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-400'}"
                    id="label-rutinan-${key}" onclick="event.stopPropagation()">
                    <input type="radio" name="jenis-libur-${key}" id="radio-rutinan-${key}" value="rutinan"
                      ${isRutinan ? 'checked' : ''} onchange="onJenisLiburChange('${key}','rutinan')" class="accent-purple-500">
                    <i class="fas fa-redo text-xs"></i> Rutinan
                  </label>
                  <label class="flex-1 flex items-center gap-1.5 cursor-pointer rounded-lg border px-2 py-1.5 text-[11px] font-semibold
                    ${!isRutinan ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-400'}"
                    id="label-khusus-${key}" onclick="event.stopPropagation()">
                    <input type="radio" name="jenis-libur-${key}" id="radio-khusus-${key}" value="khusus"
                      ${!isRutinan ? 'checked' : ''} onchange="onJenisLiburChange('${key}','khusus')" class="accent-red-500">
                    <i class="fas fa-star text-xs"></i> Khusus
                  </label>
                </div>
                <div id="ket-khusus-wrap-${key}" class="${!isRutinan ? '' : 'hidden'}">
                  <label class="text-[9px] text-gray-400 mb-0.5 block">Keterangan (akan masuk ke Daftar Hari Libur)</label>
                  <input type="text" id="h${key}_ket_libur" value="${ketLibur}"
                    placeholder="cth: Pertemuan Guru, Libur Semester..."
                    class="w-full border border-red-200 rounded text-[11px] p-1.5 focus:ring-red-300 focus:border-red-400 bg-white text-gray-700"
                    onclick="event.stopPropagation()">
                </div>
                <p id="ket-rutinan-info-${key}" class="text-[10px] text-purple-400 italic mt-0.5 ${isRutinan ? '' : 'hidden'}">
                  <i class="fas fa-info-circle mr-1"></i>Libur rutinan tidak dicatat ke Daftar Hari Libur
                </p>
              </div>
              <div id="detail-hari-${key}" class="${isLibur ? 'hidden' : ''}">
                <div class="px-3 pb-3 pt-1 border-t border-gray-200 grid grid-cols-2 gap-2">
                  <div>
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-1">⏰ Datang</p>
                    <div class="flex gap-1">
                      <div class="flex-1">
                        <label class="text-[9px] text-gray-500">Buka</label>
                        <input type="time" id="h${key}_masuk_mulai" value="${hari.masuk_mulai||'06:00'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                      <div class="flex-1">
                        <label class="text-[9px] text-orange-500">Batas</label>
                        <input type="time" id="h${key}_masuk_akhir" value="${hari.masuk_akhir||'07:15'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                    </div>
                  </div>
                  <div>
                    <p class="text-[9px] uppercase font-bold text-gray-400 mb-1">🏠 Pulang</p>
                    <div class="flex gap-1">
                      <div class="flex-1">
                        <label class="text-[9px] text-gray-500">Buka</label>
                        <input type="time" id="h${key}_pulang_mulai" value="${hari.pulang_mulai||'15:00'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                      <div class="flex-1">
                        <label class="text-[9px] text-gray-500">Tutup</label>
                        <input type="time" id="h${key}_pulang_akhir" value="${hari.pulang_akhir||'17:00'}"
                          class="w-full border border-gray-300 rounded text-[11px] p-1 focus:ring-indigo-400 focus:border-indigo-400">
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>`;
        }
        container.innerHTML = html;
    }

    function onToggleMasuk(key, isChecked) {
        const isLibur = !isChecked;
        const detail = document.getElementById('detail-hari-' + key);
        const badge = document.getElementById('badge-' + key);
        const card = document.getElementById('card-hari-' + key);
        const ketWrap = document.getElementById('ket-libur-wrap-' + key);
        if (isLibur) {
            detail.classList.add('hidden');
            if (ketWrap) ketWrap.classList.remove('hidden');
            card.className = card.className.replace('bg-gray-50 border-gray-200','bg-red-50 border-red-200');
            // Default ke Rutinan saat toggle ke libur
            const radioRutinan = document.getElementById('radio-rutinan-' + key);
            if (radioRutinan && !radioRutinan.checked && !document.getElementById('radio-khusus-'+key).checked) {
                radioRutinan.checked = true;
            }
            // Update badge sesuai pilihan saat ini
            _updateBadgeLibur(key);
        } else {
            detail.classList.remove('hidden');
            if (ketWrap) ketWrap.classList.add('hidden');
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700';
            badge.innerHTML = '<i class="fas fa-check-circle mr-1"></i>Masuk';
            card.className = card.className.replace('bg-red-50 border-red-200','bg-gray-50 border-gray-200');
        }
        if (_jadwalHarian) _jadwalHarian[key].libur = isLibur;
    }

    function onJenisLiburChange(key, jenis) {
        const isRutinan = (jenis === 'rutinan');
        const ketWrap = document.getElementById('ket-khusus-wrap-' + key);
        const infoRutinan = document.getElementById('ket-rutinan-info-' + key);
        const labelRutinan = document.getElementById('label-rutinan-' + key);
        const labelKhusus = document.getElementById('label-khusus-' + key);
        if (isRutinan) {
            if (ketWrap) ketWrap.classList.add('hidden');
            if (infoRutinan) infoRutinan.classList.remove('hidden');
            if (labelRutinan) labelRutinan.className = labelRutinan.className
                .replace('bg-white border-gray-200 text-gray-400','bg-purple-50 border-purple-300 text-purple-700');
            if (labelKhusus) labelKhusus.className = labelKhusus.className
                .replace('bg-red-50 border-red-300 text-red-700','bg-white border-gray-200 text-gray-400');
        } else {
            if (ketWrap) ketWrap.classList.remove('hidden');
            if (infoRutinan) infoRutinan.classList.add('hidden');
            if (labelKhusus) labelKhusus.className = labelKhusus.className
                .replace('bg-white border-gray-200 text-gray-400','bg-red-50 border-red-300 text-red-700');
            if (labelRutinan) labelRutinan.className = labelRutinan.className
                .replace('bg-purple-50 border-purple-300 text-purple-700','bg-white border-gray-200 text-gray-400');
            // Fokus ke input keterangan
            setTimeout(() => {
                const inp = document.getElementById('h' + key + '_ket_libur');
                if (inp) inp.focus();
            }, 50);
        }
        _updateBadgeLibur(key);
    }

    function _updateBadgeLibur(key) {
        const badge = document.getElementById('badge-' + key);
        const radioRutinan = document.getElementById('radio-rutinan-' + key);
        const isRutinan = radioRutinan ? radioRutinan.checked : true;
        if (isRutinan) {
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-600';
            badge.innerHTML = '<i class="fas fa-redo mr-1"></i>Libur Rutin';
        } else {
            badge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600';
            badge.innerHTML = '<i class="fas fa-star mr-1"></i>Libur Khusus';
        }
    }

    function toggleHariExpand(key) {
        const toggle = document.getElementById('toggle-libur-' + key);
        if (!toggle.checked) return; // sedang libur, tidak bisa expand
        const detail = document.getElementById('detail-hari-' + key);
        detail.classList.toggle('hidden');
    }

    function loadGlobalConfig() {
        const container = document.getElementById('jadwal-hari-container');
        if (container) container.innerHTML = '<div class="text-center py-6 text-gray-400 text-xs"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat jadwal...</div>';

        gas.run.withSuccessHandler(res => {
            if(res.success) {
                const conf = res.data;
                const defaultHari = {libur:false, masuk_mulai:'06:00', masuk_akhir:'07:15', pulang_mulai:'15:00', pulang_akhir:'17:00'};
                const jadwal = conf.jadwal_harian || {};
                for(let d=1;d<=7;d++){
                    if(!jadwal[String(d)]) jadwal[String(d)] = {...defaultHari, libur: d===7};
                }
                renderJadwalHarian(jadwal);
            } else {
                if(container) container.innerHTML = '<div class="text-center py-4 text-red-400 text-xs">Gagal memuat konfigurasi.</div>';
            }
        }).withFailureHandler(err => {
            if(container) container.innerHTML = '<div class="text-center py-4 text-red-400 text-xs">Error: ' + err + '</div>';
        }).getAppConfig();
    }

    function saveGlobalConfig(e) {
        e.preventDefault();
        const btn = document.getElementById('btnSaveConfig');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';

        // Kumpulkan jadwal dari form
        const jadwal = {};
        for (let d = 1; d <= 7; d++) {
            const key = String(d);
            const toggle = document.getElementById('toggle-libur-' + key);
            const isLibur = toggle ? !toggle.checked : (d === 7);
            jadwal[key] = {
                libur: isLibur,
                masuk_mulai:  (document.getElementById('h'+key+'_masuk_mulai')  || {value:'06:00'}).value || '06:00',
                masuk_akhir:  (document.getElementById('h'+key+'_masuk_akhir')  || {value:'07:15'}).value || '07:15',
                pulang_mulai: (document.getElementById('h'+key+'_pulang_mulai') || {value:'15:00'}).value || '15:00',
                pulang_akhir: (document.getElementById('h'+key+'_pulang_akhir') || {value:'17:00'}).value || '17:00',
                libur_rutinan: (() => {
                    const r = document.getElementById('radio-rutinan-'+key);
                    // Jika tidak libur, libur_rutinan tidak relevan; default true
                    if (!isLibur) return true;
                    return r ? r.checked : true;
                })(),
                ket_libur:    (document.getElementById('h'+key+'_ket_libur')    || {value:''}).value.trim() || '',
            };
        }

        // Ambil jam default dari hari Senin (tidak libur) sebagai backward-compat
        const refDay = Object.values(jadwal).find(h => !h.libur) || jadwal['1'];
        const newConfig = {
            jam_masuk_mulai:  refDay.masuk_mulai,
            jam_masuk_akhir:  refDay.masuk_akhir,
            jam_pulang_mulai: refDay.pulang_mulai,
            jam_pulang_akhir: refDay.pulang_akhir,
            jadwal_harian: jadwal
        };

        gas.run.withSuccessHandler(res => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            if(res.success) {
                showAlert('success', 'Pengaturan waktu berhasil disimpan!');
            } else {
                showAlert('error', res.message);
            }
        }).withFailureHandler(err => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            showAlert('error', 'Gagal koneksi: ' + err);
        }).saveAppConfig(newConfig);
    }


    function renderLiburRows(data, startIdx) {
            const tbody = document.getElementById('tbody-libur');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400 italic">Tidak ada jadwal libur.</td></tr>';
                return;
            }
            
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            
            tbody.innerHTML = data.map((item, i) => `
                <tr class="hover:bg-gray-50 border-b border-gray-50 transition group">
                    <td class="p-4 text-center text-gray-500">${startIdx + i + 1}</td>
                    <td class="p-4 font-mono font-medium text-indigo-700">
                        ${new Date(item.tanggal).toLocaleDateString('id-ID', options)}
                    </td>
                    <td class="p-4 font-bold text-gray-700">${item.keterangan}</td>
                    <td class="p-4 text-center">
                        <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                            <button onclick="editLibur('${item.tanggal}', '${item.keterangan}')" class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button onclick="deleteLiburConfirm('${item.tanggal}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }

  // 1. Fungsi Trigger saat tombol edit ditekan
      function editLibur(tgl, ket) {
          // Tampilkan modal dengan data yang sudah terisi
          showModal(createLiburModal({ tanggal: tgl, keterangan: ket }));
      }

      function createLiburModal(data) {
              const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-3 transition-all mb-4";
              
              return `
              <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative overflow-hidden animate-fade-in">
                  <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                      <i class="fas fa-times"></i>
                  </button>
                  
                  <div class="text-center mb-6">
                      <div class="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl shadow-sm">
                          <i class="fas fa-calendar-day"></i>
                      </div>
                      <h3 class="font-bold text-xl text-gray-800">Edit Hari Libur</h3>
                      <p class="text-xs text-gray-500 mt-1">Perbarui tanggal atau keterangan</p>
                  </div>
                  
                  <form onsubmit="saveUpdateLibur(event)">
                      <input type="hidden" name="oldDate" value="${data.tanggal}">
                      
                      <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Tanggal</label>
                      <input type="date" name="newDate" value="${data.tanggal}" required class="${inputClass}">
                      
                      <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Keterangan</label>
                      <input type="text" name="newKeterangan" value="${data.keterangan}" required placeholder="Contoh: Cuti Bersama" class="${inputClass}">

                      <div class="flex gap-3 mt-4">
                          <button type="button" onclick="closeModal()" class="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition">
                              Batal
                          </button>
                          <button type="submit" id="btnSaveLibur" class="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2">
                              Simpan Perubahan
                          </button>
                      </div>
                  </form>
              </div>`;
          }

          // 3. Fungsi Simpan Perubahan (Submit Form Modal)
      function saveUpdateLibur(e) {
        e.preventDefault();
        
        // 1. Ambil elemen tombol
        const btn = document.getElementById('btnSaveLibur');
        const originalText = btn.innerHTML; // Simpan teks asli
        
        // 2. Ubah tampilan tombol menjadi Loading
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Menyimpan...';
        btn.classList.add('opacity-75', 'cursor-not-allowed'); // Visual feedback tambahan

        // Tetap tampilkan loading overlay global (opsional, bisa dihapus jika ingin hanya tombol saja)
        showLoading(); 
        
        const fd = new FormData(e.target);
        const oldDate = fd.get('oldDate');
        const newDate = fd.get('newDate');
        const newKet = fd.get('newKeterangan');
        
        gas.run.withSuccessHandler(res => {
            hideLoading(); // Sembunyikan overlay global
            
            // 3. Kembalikan tombol ke keadaan semula (penting jika terjadi error)
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');

            if (res.success) {
                closeModal();
                loadKelolaAbsen(); 
                showAlert('success', res.message);
            } else {
                showAlert('error', res.message);
            }
        })
        .withFailureHandler(error => {
            // Handler jika koneksi gagal total
            hideLoading();
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
            showAlert('error', 'Gagal menghubungi server: ' + error);
        })
        .updateHariLibur(oldDate, newDate, newKet);
    }
            
    function updatePreviewLibur() {
        const mulai = document.getElementById('input-libur-mulai').value;
        const akhir = document.getElementById('input-libur-akhir').value;
        const preview = document.getElementById('preview-libur');
        const previewText = document.getElementById('preview-libur-text');
        if (!mulai || !akhir) { preview.classList.add('hidden'); return; }
        const dMulai = new Date(mulai + 'T00:00:00');
        const dAkhir = new Date(akhir + 'T00:00:00');
        if (dAkhir < dMulai) {
            previewText.textContent = '⚠ Tanggal akhir tidak boleh sebelum tanggal mulai.';
            preview.classList.remove('hidden');
            preview.className = preview.className.replace('bg-amber-50 border-amber-200 text-amber-700','bg-red-50 border-red-200 text-red-600');
            return;
        }
        preview.className = 'bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs text-amber-700 flex items-center gap-2';
        const selisih = Math.round((dAkhir - dMulai) / (1000*60*60*24)) + 1;
        const fmtOpt = { day: 'numeric', month: 'long', year: 'numeric' };
        if (selisih === 1) {
            previewText.textContent = '1 hari: ' + dMulai.toLocaleDateString('id-ID', fmtOpt);
        } else {
            previewText.textContent = selisih + ' hari: ' + dMulai.toLocaleDateString('id-ID', fmtOpt) + ' s/d ' + dAkhir.toLocaleDateString('id-ID', fmtOpt);
        }
        preview.classList.remove('hidden');
    }

    function handleAddLibur(e) {
        e.preventDefault();
        const fd = new FormData(e.target);
        const tglMulai = fd.get('tanggal_mulai');
        const tglAkhir = fd.get('tanggal_akhir');
        const ket = fd.get('keterangan');

        // Validasi range
        if (tglAkhir < tglMulai) {
            showAlert('error', 'Tanggal akhir tidak boleh sebelum tanggal mulai.');
            return;
        }

        showLoading();
        gas.run.withSuccessHandler(res => {
            hideLoading();
            if (res.success) {
                e.target.reset();
                document.getElementById('preview-libur').classList.add('hidden');
                loadKelolaAbsen();
                showAlert('success', res.message);
            } else {
                showAlert('error', res.message);
            }
        }).withFailureHandler(err => {
            hideLoading();
            showAlert('error', 'Gagal: ' + err);
        }).addHariLiburRange(tglMulai, tglAkhir, ket);
    }

    function deleteLiburConfirm(tgl) {
        if (confirm('Hapus hari libur ini? Siswa akan bisa absen kembali pada tanggal tersebut.')) {
            showLoading();
            gas.run.withSuccessHandler(res => {
                hideLoading();
                loadKelolaAbsen();
                showAlert('success', 'Jadwal libur dihapus');
            }).deleteHariLibur(tgl);
        }
    }

    // --- DATA SISWA ---
// 
// Cari function loadDataSiswa() dan GANTI SEMUANYA dengan ini:

function loadDataSiswa() {
    stopAndBack(false);
    setActiveMenu('Data Siswa');
    showView('view-data-siswa');
    
    // 1. Tentukan Filter Kelas Berdasarkan Role
    // Guru: currentUser.kelas bisa berisi "Kelas A" atau "Kelas A,Kelas B"
    const filterKelas = (currentUser.role === 'guru') ? currentUser.kelas : null;
    // Untuk judul halaman: list kelas yang dipisah koma
    const kelasLabel = filterKelas
        ? String(filterKelas).split(',').map(k => k.trim()).filter(Boolean).join(', ')
        : null;

    // --- JUDUL HALAMAN DISESUAIKAN ---
    const pageTitle = document.querySelector('#view-data-siswa h3');
    if (kelasLabel) {
        pageTitle.textContent = `Direktori Siswa (${kelasLabel})`;
        // Sembunyikan dropdown filter kelas karena guru hanya boleh lihat kelasnya
        document.getElementById('filterKelasSiswa').parentElement.style.display = 'none';
    } else {
        pageTitle.textContent = 'Direktori Siswa';
        // Tampilkan dropdown filter untuk Admin
        document.getElementById('filterKelasSiswa').parentElement.style.display = 'flex';
    }

    // --- LOGIKA POPULATE DROPDOWN (Khusus Admin) ---
    const dropdown = document.getElementById('filterKelasSiswa');
    const fillDropdown = (dataKelas) => {
        if (!dropdown) return;
        const currentValue = dropdown.value; 
        let options = '<option value="">Semua Kelas</option>';
        if (dataKelas && dataKelas.length > 0) {
            dataKelas.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
        }
        dropdown.innerHTML = options;
        if (currentValue) dropdown.value = currentValue;
    };

    if (existingClasses && existingClasses.length > 0) {
        fillDropdown(existingClasses);
    } else {
        dropdown.innerHTML = '<option value="">Memuat data...</option>';
        gas.run.withSuccessHandler(result => {
            if (result.success) {
                existingClasses = result.data;
                fillDropdown(existingClasses);
            }
        }).getKelasList();
    }

    // --- AMBIL DATA SISWA DENGAN PARAMETER FILTER ---
    // Reset tabel dulu agar terlihat loading
    document.getElementById('tbody-siswa').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data siswa...</td></tr>';
    
    // Panggil Backend dengan parameter filterKelas
    gas.run.withSuccessHandler(result => {
        if (result.success) {
            tableState.siswa.fullData = result.data;
            processTableData('siswa');
        } else {
            showAlert('error', result.message);
        }
    }).getSiswaList(filterKelas); // <--- PERUBAHAN UTAMA DISINI
}

function renderSiswaRows(data, startIdx) {
        const tbody = document.getElementById('tbody-siswa');
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
            return;
        }
        tbody.innerHTML = data.map((siswa, i) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
            <td class="p-4 text-center text-gray-500 text-sm">${startIdx + i + 1}</td>
            <td class="p-4">
                <div class="flex items-center">
                    <div class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold mr-3">
                        ${siswa.nama.charAt(0)}
                    </div>
                    <div>
                        <div class="font-bold text-sm text-gray-900">${siswa.nama}</div>
                        <div class="text-xs text-gray-500 md:hidden">${siswa.nis}</div>
                    </div>
                </div>
            </td>
            <td class="p-4 hidden md:table-cell text-sm text-gray-600 font-mono">${siswa.nis}</td>
            <td class="p-4 hidden sm:table-cell"><span class="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold">${siswa.kelas}</span></td>
            <td class="p-4 text-center">
                <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                    <button onclick='viewSiswa(${JSON.stringify(siswa)})' class="p-2 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition" title="Lihat Detail">
                        <i class="fas fa-eye"></i>
                    </button>
                    
                    <button onclick='editSiswa(${JSON.stringify(siswa)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteSiswaConfirm('${siswa.nis}', '${siswa.nama}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus"><i class="fas fa-trash"></i></button>
                    <button onclick="generateQRForSiswa('${siswa.noKartu || ''}', '${siswa.nama}', '${siswa.kelas}')" class="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition" title="QR Code"><i class="fas fa-qrcode"></i></button>
                </div>
            </td>
        </tr>`).join('');
    }

    // --- DATA GURU ---
function loadDataGuru() {
        stopAndBack(false);
        setActiveMenu('Data Guru');
        showView('view-data-guru');
        
        // --- LOGIKA POPULATE DROPDOWN KELAS GURU ---
        const dropdown = document.getElementById('filterKelasGuru');
        if (dropdown && existingClasses && existingClasses.length > 0) {
            const currentValue = dropdown.value; 
            
            let options = '<option value="">Semua Kelas</option>';
            existingClasses.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
            dropdown.innerHTML = options;
            
            if (currentValue) dropdown.value = currentValue;
        }
        // --------------------------------------------------

        // Cek Cache Data
        if (tableState.guru.fullData.length > 0) {
            processTableData('guru');
        } else {
            // Tampilkan Loading di Tabel
            document.getElementById('tbody-guru').innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data guru...</td></tr>';
            
            // === KEAMANAN: AMBIL TOKEN ===
            const token = currentUser.token;

            // Panggil Backend dengan Token
            gas.run.withSuccessHandler(result => {
                if (result.success) {
                    tableState.guru.fullData = result.data;
                    processTableData('guru');
                } else {
                    // Jika gagal (Token invalid/Bukan Admin)
                    document.getElementById('tbody-guru').innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${result.message}</td></tr>`;
                    showAlert('error', result.message);
                }
            })
            .withFailureHandler(error => {
                document.getElementById('tbody-guru').innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500">Gagal koneksi: ${error}</td></tr>`;
            })
            .getGuruList(token); // <-- PARAMETER TOKEN DITAMBAHKAN DI SINI
        }
    }

// UPDATE: Menampilkan kolom kelas di tabel
function renderGuruRows(data, startIdx) {
    const tbody = document.getElementById('tbody-guru');
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
        return;
    }
    tbody.innerHTML = data.map((guru, i) => {
        // Render semua kelas sebagai badge terpisah
        const kelasBadges = guru.kelas
            ? String(guru.kelas).split(',').map(k => k.trim()).filter(Boolean)
                .map(k => `<span class="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-xs font-bold">${k}</span>`)
                .join(' ')
            : '<span class="text-gray-400 italic text-xs">Semua Akses</span>';
        return `
    <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
        <td class="p-4 text-center text-gray-500 text-sm">${startIdx + i + 1}</td>
        <td class="p-4 text-sm font-bold text-gray-800">${guru.username}</td>
        <td class="p-4 text-sm">
            <div class="flex flex-wrap gap-1">${kelasBadges}</div>
        </td>
        <td class="p-4 text-sm text-gray-400 font-mono">••••••••</td>
        <td class="p-4 text-center">
            <div class="flex justify-center space-x-2 opacity-80 group-hover:opacity-100">
                <button onclick='editGuru(${JSON.stringify(guru)})' class="p-2 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition" title="Edit Akun"><i class="fas fa-edit"></i></button>
                <button onclick="deleteGuruConfirm('${guru.username}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition" title="Hapus Akun"><i class="fas fa-trash"></i></button>
            </div>
        </td>
    </tr>`}).join('');
}
function saveSiswa(e, isEdit) {
    e.preventDefault();
    showLoading();

    const fd = new FormData(e.target);
    const siswaData = {
        nama: fd.get('nama'),
        nis: "'" + fd.get('nis'),
        jenisKelamin: fd.get('jenisKelamin'),
        tanggalLahir: fd.get('tanggalLahir'),
        agama: fd.get('agama'),
        namaAyah: fd.get('namaAyah'),
        namaIbu: fd.get('namaIbu'),
        noHp: "'" + fd.get('noHp'),
        kelas: fd.get('kelas'),
        alamat: fd.get('alamat'),
        noAbsen: fd.get('noAbsen'),
        noKartu: fd.get('noKartu') ? "'" + fd.get('noKartu') : ''
    };

    // --- PERUBAHAN UTAMA DISINI ---
    // Ambil token dari user yang sedang login
    const token = currentUser ? currentUser.token : null; 
    // ------------------------------

    const callback = (res) => {
        hideLoading();
        if (res.success) {
            closeModal();
            tableState.siswa.fullData = [];
            loadDataSiswa();
            showAlert('success', res.message);
        } else {
            showAlert('error', res.message);
        }
    };

    const failureCallback = (err) => {
        hideLoading();
        showAlert('error', 'Terjadi kesalahan: ' + err);
    };

    // Kirim Token ke Server
    if (isEdit) {
        const oldNis = fd.get('oldNis');
        gas.run
            .withSuccessHandler(callback)
            .withFailureHandler(failureCallback)
            .updateSiswa(token, oldNis, siswaData); // <-- Pastikan updateSiswa di code.gs juga sudah ditambah parameter token!
    } else {
        gas.run
            .withSuccessHandler(callback)
            .withFailureHandler(failureCallback)
            .addSiswa(token, siswaData); // <-- KIRIM TOKEN
    }
}
    // ==========================================================================
    // INPUT PELANGGARAN (MENU GURU)
    // ==========================================================================
    let pelanggaranSiswaCache = []; // Cache daftar siswa untuk autocomplete nama
    let masterPelanggaranCache = []; // Cache master kode/jenis/point pelanggaran (auto-isi)

    function loadPelanggaran() {
        stopAndBack(false);
        setActiveMenu('Input Pelanggaran');
        showView('view-pelanggaran');

        // Populate dropdown filter kelas
        const dropdown = document.getElementById('filterKelasPelanggaran');
        if (dropdown && existingClasses && existingClasses.length > 0) {
            const currentValue = dropdown.value;
            let options = '<option value="">Semua Kelas</option>';
            existingClasses.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
            dropdown.innerHTML = options;
            if (currentValue) dropdown.value = currentValue;
        }

        // Siapkan cache siswa untuk autocomplete (sekali ambil, dipakai berulang)
        if (pelanggaranSiswaCache.length === 0) {
            gas.run.withSuccessHandler(result => {
                if (result.success) pelanggaranSiswaCache = result.data;
            }).getSiswaList();
        }

        // Siapkan cache master pelanggaran (kode -> jenis & point) untuk auto-isi
        if (masterPelanggaranCache.length === 0) {
            const token = currentUser ? currentUser.token : null;
            gas.run.withSuccessHandler(result => {
                if (result.success) masterPelanggaranCache = result.data;
            }).getMasterPelanggaranList(token);
        }

        // Ambil data pelanggaran
        if (tableState.pelanggaran.fullData.length > 0) {
            processTableData('pelanggaran');
        } else {
            document.getElementById('tbody-pelanggaran').innerHTML = '<tr><td colspan="10" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data pelanggaran...</td></tr>';

            const token = currentUser.token;
            gas.run.withSuccessHandler(result => {
                if (result.success) {
                    tableState.pelanggaran.fullData = result.data;
                    processTableData('pelanggaran');
                } else {
                    document.getElementById('tbody-pelanggaran').innerHTML = `<tr><td colspan="10" class="p-8 text-center text-red-500 font-bold"><i class="fas fa-exclamation-triangle mr-2"></i>${result.message}</td></tr>`;
                    showAlert('error', result.message);
                }
            })
            .withFailureHandler(error => {
                document.getElementById('tbody-pelanggaran').innerHTML = `<tr><td colspan="10" class="p-8 text-center text-red-500">Gagal koneksi: ${error}</td></tr>`;
            })
            .getPelanggaranList(token);
        }
    }

    function exportPelanggaranExcel() {
        const dari = document.getElementById('plgFilterDari').value;
        const sampai = document.getElementById('plgFilterSampai').value;

        if (!dari || !sampai) {
            showAlert('error', 'Pilih tanggal "Dari" dan "Sampai" terlebih dahulu sebelum export.');
            return;
        }
        if (dari > sampai) {
            showAlert('error', 'Tanggal "Dari" tidak boleh lebih besar dari tanggal "Sampai".');
            return;
        }

        // Pastikan filter tanggal sudah diterapkan ke data yang mau diekspor
        tableState.pelanggaran.dateFrom = dari;
        tableState.pelanggaran.dateTo = sampai;
        processTableData('pelanggaran');

        const data = tableState.pelanggaran.filtered;
        if (!data || data.length === 0) {
            showAlert('error', 'Tidak ada data pelanggaran pada periode yang dipilih.');
            return;
        }

        // 1. Kumpulkan siswa unik (urut nama)
        const siswaMap = {};
        data.forEach(d => {
            if (!siswaMap[d.nis]) siswaMap[d.nis] = { nama: d.nama, nis: d.nis, kelas: d.kelas };
        });
        const siswaList = Object.values(siswaMap).sort((a, b) => String(a.nama).localeCompare(String(b.nama)));

        // 2. Kumpulkan tanggal unik yang benar-benar ada datanya (urut ascending)
        const tanggalList = Array.from(new Set(data.map(d => d.tanggal))).sort();

        // 3. Peta cepat: "nis|tanggal" -> daftar kode pelanggaran
        const cellMap = {};
        data.forEach(d => {
            const key = d.nis + '|' + d.tanggal;
            if (!cellMap[key]) cellMap[key] = [];
            cellMap[key].push(d.kodePelanggaran);
        });

        const totalCols = 4 + tanggalList.length; // No, Nama Siswa, NIS, Kelas + kolom tanggal

        const fmtTgl = (s) => { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}`; };
        const periodeText = `Periode : ${fmtTgl(dari)} s/d ${fmtTgl(sampai)}`;

        const rows = [];
        rows.push(['Rekap Pelanggaran', ...Array(totalCols - 1).fill('')]);
        rows.push([periodeText, ...Array(totalCols - 1).fill('')]);
        rows.push(['No', 'Nama Siswa', 'NIS', 'Kelas', 'TANGGAL', ...Array(Math.max(0, tanggalList.length - 1)).fill('')]);
        rows.push(['', '', '', '', ...tanggalList.map(t => parseInt(t.split('-')[2], 10))]);

        siswaList.forEach((s, idx) => {
            const row = [idx + 1, s.nama, s.nis, s.kelas];
            tanggalList.forEach(t => {
                const key = s.nis + '|' + t;
                row.push(cellMap[key] ? cellMap[key].join(', ') : '');
            });
            rows.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);

        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }, // Judul
            { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } }, // Periode
            { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, // No
            { s: { r: 2, c: 1 }, e: { r: 3, c: 1 } }, // Nama Siswa
            { s: { r: 2, c: 2 }, e: { r: 3, c: 2 } }, // NIS
            { s: { r: 2, c: 3 }, e: { r: 3, c: 3 } }  // Kelas
        ];
        if (tanggalList.length > 1) {
            merges.push({ s: { r: 2, c: 4 }, e: { r: 2, c: 4 + tanggalList.length - 1 } }); // TANGGAL
        }
        ws['!merges'] = merges;

        ws['!cols'] = [{ wch: 5 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, ...tanggalList.map(() => ({ wch: 6 }))];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rekap Pelanggaran');
        XLSX.writeFile(wb, `Rekap_Pelanggaran_${dari}_sd_${sampai}.xlsx`);
    }

    function refreshPelanggaran() {
        tableState.pelanggaran.fullData = [];
        loadPelanggaran();
        showAlert('success', 'Data pelanggaran diperbarui.');
    }

    function renderPelanggaranRows(data, startIdx) {
        const tbody = document.getElementById('tbody-pelanggaran');
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center text-gray-400">Data tidak ditemukan.</td></tr>';
            return;
        }
        tbody.innerHTML = data.map((p, i) => `
        <tr class="hover:bg-gray-50 transition border-b border-gray-50 group">
            <td class="p-3 text-center text-gray-500">${startIdx + i + 1}</td>
            <td class="p-3 whitespace-nowrap">${p.tanggal}</td>
            <td class="p-3 font-bold text-gray-800">${p.nama}</td>
            <td class="p-3 hidden md:table-cell font-mono">${p.nis}</td>
            <td class="p-3 hidden sm:table-cell"><span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold">${p.kelas || '-'}</span></td>
            <td class="p-3"><span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">${p.kodePelanggaran}</span></td>
            <td class="p-3">${p.jenisPelanggaran}</td>
            <td class="p-3 text-center font-bold text-red-600">${p.point}</td>
            <td class="p-3 hidden lg:table-cell text-gray-500">${p.inputOleh || '-'}</td>
            <td class="p-3 text-center">
                ${p.tandaTangan ? `<a href="${p.tandaTangan}" target="_blank" class="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition inline-block opacity-80 group-hover:opacity-100 mr-1" title="Lihat Tanda Tangan"><i class="fas fa-signature"></i></a>` : ''}
                ${currentUser && currentUser.role === 'admin' ? `<button onclick="hapusPelanggaran('${p.id}', '${String(p.nama).replace(/'/g, "\\'")}')" class="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition opacity-80 group-hover:opacity-100" title="Hapus"><i class="fas fa-trash"></i></button>` : (!p.tandaTangan ? '<span class="text-gray-300 text-xs">-</span>' : '')}
            </td>
        </tr>`).join('');
    }

    // Hapus data pelanggaran (khusus admin)
    function hapusPelanggaran(id, nama) {
        Swal.fire({
            title: 'Hapus data pelanggaran?',
            text: `Data pelanggaran ${nama} akan dihapus permanen dan tidak bisa dikembalikan.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Ya, Hapus',
            cancelButtonText: 'Batal',
            confirmButtonColor: '#dc2626'
        }).then(res => {
            if (!res.isConfirmed) return;
            showLoading();
            const token = currentUser.token;
            gas.run
                .withSuccessHandler(result => {
                    hideLoading();
                    if (result.success) {
                        tableState.pelanggaran.fullData = [];
                        loadPelanggaran();
                        showAlert('success', result.message);
                    } else {
                        showAlert('error', result.message);
                    }
                })
                .withFailureHandler(err => {
                    hideLoading();
                    showAlert('error', 'Terjadi kesalahan: ' + err);
                })
                .deletePelanggaran(token, id);
        });
    }

    // --- Tanda Tangan Digital (canvas pad) untuk Tambah Pelanggaran ---
    let sigCtx = null;
    let sigDrawing = false;
    let sigHasDrawn = false;

    function initSignaturePad() {
        const canvas = document.getElementById('plgSignatureCanvas');
        if (!canvas) return;

        // Samakan resolusi internal canvas dengan ukuran tampilnya (biar gak buram/geser)
        const ratio = window.devicePixelRatio || 1;
        canvas.width = canvas.clientWidth * ratio;
        canvas.height = canvas.clientHeight * ratio;

        sigCtx = canvas.getContext('2d');
        sigCtx.scale(ratio, ratio);
        sigCtx.lineWidth = 2.2;
        sigCtx.lineCap = 'round';
        sigCtx.strokeStyle = '#1f2937';
        sigHasDrawn = false;

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const t = e.touches ? e.touches[0] : e;
            return { x: t.clientX - rect.left, y: t.clientY - rect.top };
        };
        const start = (e) => { e.preventDefault(); sigDrawing = true; const p = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
        const move = (e) => {
            if (!sigDrawing) return;
            e.preventDefault();
            const p = getPos(e);
            sigCtx.lineTo(p.x, p.y);
            sigCtx.stroke();
            sigHasDrawn = true;
        };
        const end = () => { sigDrawing = false; };

        canvas.onmousedown = start; canvas.onmousemove = move; canvas.onmouseup = end; canvas.onmouseleave = end;
        canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;
    }

    function clearSignaturePad() {
        const canvas = document.getElementById('plgSignatureCanvas');
        if (!canvas || !sigCtx) return;
        sigCtx.clearRect(0, 0, canvas.width, canvas.height);
        sigHasDrawn = false;
    }

    // Return null kalau belum ada coretan sama sekali (biar gak nyimpan gambar kosong)
    function getSignatureDataUrl() {
        const canvas = document.getElementById('plgSignatureCanvas');
        if (!canvas || !sigHasDrawn) return null;
        return canvas.toDataURL('image/png');
    }

    function showAddPelanggaranModal() {
        showModal(createPelanggaranModal());
        setTimeout(initSignaturePad, 50);
    }

    function createPelanggaranModal() {
        const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5 transition-all";
        const labelClass = "block mb-1 text-xs font-bold text-gray-500 uppercase tracking-wide";
        const today = new Date().toISOString().split('T')[0];

        return `
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-800"><i class="fas fa-exclamation-triangle text-red-500 mr-2"></i>Tambah Pelanggaran</h3>
                <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div class="p-6 max-h-[75vh] overflow-y-auto">
                <form onsubmit="savePelanggaran(event)" class="space-y-5">

                    <div class="relative">
                        <label class="${labelClass}">Nama Siswa</label>
                        <input type="text" id="plgNamaInput" value="" autocomplete="off" required
                            class="${inputClass}" placeholder="Ketik nama siswa..."
                            oninput="filterPelanggaranSiswaDropdown(this.value)"
                            onfocus="filterPelanggaranSiswaDropdown(this.value)"
                            onblur="closePelanggaranSiswaDropdown()">
                        <div id="dropdownPelanggaranSiswa" class="hidden absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto mt-1 scrollbar-hide"></div>
                    </div>

                    <div class="grid grid-cols-2 gap-5">
                        <div>
                            <label class="${labelClass}">NIS</label>
                            <input type="text" id="plgNis" value="" readonly class="${inputClass} opacity-70 cursor-not-allowed" placeholder="Otomatis terisi">
                        </div>
                        <div>
                            <label class="${labelClass}">Kelas</label>
                            <input type="text" id="plgKelas" value="" readonly class="${inputClass} opacity-70 cursor-not-allowed" placeholder="Otomatis terisi">
                        </div>
                    </div>

                    <div>
                        <label class="${labelClass}">Tanggal</label>
                        <input type="date" id="plgTanggal" value="${today}" required class="${inputClass}">
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div class="relative">
                            <label class="${labelClass}">Kode Pelanggaran</label>
                            <input type="text" id="plgKode" value="" autocomplete="off" required class="${inputClass}" placeholder="Contoh: A-01"
                                oninput="filterPelanggaranKodeDropdown(this.value)"
                                onfocus="filterPelanggaranKodeDropdown(this.value)"
                                onblur="closePelanggaranKodeDropdown()">
                            <div id="dropdownPelanggaranKode" class="hidden absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto mt-1 scrollbar-hide"></div>
                        </div>
                        <div>
                            <label class="${labelClass}">Point</label>
                            <input type="number" id="plgPoint" value="" required min="0" class="${inputClass}" placeholder="Otomatis terisi">
                        </div>
                    </div>

                    <div>
                        <label class="${labelClass}">Jenis Pelanggaran</label>
                        <textarea id="plgJenis" rows="2" required class="${inputClass}" placeholder="Otomatis terisi setelah pilih Kode Pelanggaran"></textarea>
                    </div>

                    <div>
                        <label class="${labelClass}">Tanda Tangan Digital (Guru)</label>
                        <div class="border-2 border-dashed border-gray-300 rounded-xl overflow-hidden bg-gray-50">
                            <canvas id="plgSignatureCanvas" width="500" height="160" class="w-full h-40 bg-white cursor-crosshair touch-none"></canvas>
                        </div>
                        <div class="flex justify-between items-center mt-1.5">
                            <span class="text-[10px] text-gray-400">Tanda tangan langsung di kotak putih di atas.</span>
                            <button type="button" onclick="clearSignaturePad()" class="text-xs font-bold text-red-500 hover:text-red-700"><i class="fas fa-eraser mr-1"></i>Hapus</button>
                        </div>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition">Batal</button>
                        <button type="submit" class="px-6 py-2.5 bg-red-600 text-white rounded-xl font-bold shadow-lg hover:bg-red-700 transition transform active:scale-95">Simpan</button>
                    </div>
                </form>
            </div>
        </div>`;
    }

    // --- Autocomplete Nama Siswa (khusus modal Pelanggaran) ---
    function filterPelanggaranSiswaDropdown(keyword) {
        const dropdown = document.getElementById('dropdownPelanggaranSiswa');
        if (!dropdown) return;

        // Setiap kali nama diketik ulang, kosongkan NIS/Kelas (siswa harus dipilih ulang)
        const nisInput = document.getElementById('plgNis');
        const kelasInput = document.getElementById('plgKelas');
        if (nisInput) nisInput.value = '';
        if (kelasInput) kelasInput.value = '';

        if (!keyword || keyword.trim() === '') {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            return;
        }

        const kw = keyword.toLowerCase();
        const matches = pelanggaranSiswaCache.filter(s => String(s.nama).toLowerCase().includes(kw)).slice(0, 20);

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="px-4 py-3 text-xs text-gray-400 italic">Siswa tidak ditemukan.</div>';
        } else {
            dropdown.innerHTML = matches.map(s => `
                <div onmousedown="selectPelanggaranSiswa('${String(s.nama).replace(/'/g, "\\'")}', '${s.nis}', '${s.kelas}')"
                    class="px-4 py-2 hover:bg-red-50 cursor-pointer text-sm text-gray-700 transition-colors border-b border-gray-50 last:border-none">
                    <div class="font-bold">${s.nama}</div>
                    <div class="text-[10px] text-gray-400">NIS: ${s.nis} &bull; Kelas: ${s.kelas}</div>
                </div>
            `).join('');
        }
        dropdown.classList.remove('hidden');
    }

    function selectPelanggaranSiswa(nama, nis, kelas) {
        document.getElementById('plgNamaInput').value = nama;
        document.getElementById('plgNis').value = nis;
        document.getElementById('plgKelas').value = kelas;
        closePelanggaranSiswaDropdown();
    }

    function closePelanggaranSiswaDropdown() {
        const dropdown = document.getElementById('dropdownPelanggaranSiswa');
        if (dropdown) {
            setTimeout(() => dropdown.classList.add('hidden'), 200);
        }
    }

    // --- Autocomplete + Auto-isi Kode Pelanggaran (ambil dari sheet master_pelanggaran) ---
    function filterPelanggaranKodeDropdown(keyword) {
        const dropdown = document.getElementById('dropdownPelanggaranKode');
        if (!dropdown) return;

        const kw = (keyword || '').trim().toLowerCase();

        // Cek exact match dulu -> auto-isi Point & Jenis otomatis saat kode cocok persis
        const exact = masterPelanggaranCache.find(p => String(p.kode).trim().toLowerCase() === kw);
        if (exact) {
            document.getElementById('plgPoint').value = exact.point;
            document.getElementById('plgJenis').value = exact.jenis;
        }

        if (!kw) {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            return;
        }

        const matches = masterPelanggaranCache.filter(p => String(p.kode).toLowerCase().includes(kw) || String(p.jenis).toLowerCase().includes(kw)).slice(0, 20);

        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="px-4 py-3 text-xs text-gray-400 italic">Kode tidak ditemukan di master pelanggaran. Bisa diisi manual.</div>';
        } else {
            dropdown.innerHTML = matches.map(p => `
                <div onmousedown="selectPelanggaranKode('${String(p.kode).replace(/'/g, "\\'")}', '${String(p.jenis).replace(/'/g, "\\'")}', ${Number(p.point) || 0})"
                    class="px-4 py-2 hover:bg-red-50 cursor-pointer text-sm text-gray-700 transition-colors border-b border-gray-50 last:border-none">
                    <div class="font-bold">${p.kode} <span class="text-red-600 font-normal">(${p.point} poin)</span></div>
                    <div class="text-[10px] text-gray-400 truncate">${p.jenis}</div>
                </div>
            `).join('');
        }
        dropdown.classList.remove('hidden');
    }

    function selectPelanggaranKode(kode, jenis, point) {
        document.getElementById('plgKode').value = kode;
        document.getElementById('plgJenis').value = jenis;
        document.getElementById('plgPoint').value = point;
        closePelanggaranKodeDropdown();
    }

    function closePelanggaranKodeDropdown() {
        const dropdown = document.getElementById('dropdownPelanggaranKode');
        if (dropdown) {
            setTimeout(() => dropdown.classList.add('hidden'), 200);
        }
    }

    function savePelanggaran(e) {
        e.preventDefault();

        const nama = document.getElementById('plgNamaInput').value.trim();
        const nis = document.getElementById('plgNis').value.trim();
        const kelas = document.getElementById('plgKelas').value.trim();

        if (!nis) {
            showAlert('error', 'Silakan pilih nama siswa dari daftar yang muncul.');
            return;
        }

        const data = {
            nama: nama,
            nis: nis,
            kelas: kelas,
            tanggal: document.getElementById('plgTanggal').value,
            kodePelanggaran: document.getElementById('plgKode').value.trim(),
            jenisPelanggaran: document.getElementById('plgJenis').value.trim(),
            point: document.getElementById('plgPoint').value
        };

        const sigDataUrl = getSignatureDataUrl();
        if (!sigDataUrl) {
            showAlert('error', 'Mohon bubuhkan tanda tangan digital sebelum menyimpan.');
            return;
        }
        data.tandaTangan = sigDataUrl;

        showLoading();
        const token = currentUser.token;

        queueOfflineAction('Input Pelanggaran', 'addPelanggaran', [token, data], `${nama} — ${data.kodePelanggaran}`)
            .then(outcome => {
                hideLoading();
                if (outcome.viaServer) {
                    const res = outcome.result;
                    if (res.success) {
                        closeModal();
                        tableState.pelanggaran.fullData = [];
                        loadPelanggaran();
                        showAlert('success', res.message);
                    } else {
                        showAlert('error', res.message);
                    }
                } else {
                    // Offline / server gak terjangkau -> tersimpan di perangkat, dikirim saat sinkron.
                    // Belum bisa langsung muncul di tabel karena tabel diambil dari server.
                    closeModal();
                    showAlert('success', `Tersimpan offline. Data ${nama} akan terkirim otomatis saat sinkron (menu "Sinkron Data").`);
                }
            });
    }

    // --- REKAP PRESENSI ---
function loadRekapPresensi() {
    stopAndBack(false);
    setActiveMenu('Laporan');
    showView('view-rekap-presensi');
    
    // 1. Reset Tampilan (Bersihkan tabel lama)
    document.getElementById('rekapEmptyState').classList.remove('hidden');
    document.getElementById('rekapContainer').classList.add('hidden');
    document.getElementById('rekapLoading').classList.add('hidden');
    
    // Reset data di memori
    tableState.rekap.fullData = [];

    // 2. Logika Pengisian Dropdown Kelas (Anti-Kosong)
    const selectKelas = document.getElementById('fKelasRekap');
    
    // Fungsi pembantu untuk render opsi HTML
    const fillDropdown = (dataKelas) => {
        if (!selectKelas) return;
        
        // Simpan nilai yang mungkin sudah dipilih user sebelumnya (jika reload)
        const currentVal = selectKelas.value; 
        
        let options = '<option value="">Semua Kelas</option>';
        if (dataKelas && dataKelas.length > 0) {
            dataKelas.forEach(kelas => {
                options += `<option value="${kelas}">${kelas}</option>`;
            });
        }
        selectKelas.innerHTML = options;
        
        // Kembalikan pilihan user jika masih valid
        if (currentVal) selectKelas.value = currentVal;
    };

    // --- CEK DATA KELAS ---
    // A. Jika data kelas sudah tersimpan di variabel global 'existingClasses'
    if (existingClasses && existingClasses.length > 0) {
        fillDropdown(existingClasses);
    } 
    // B. Jika data masih kosong (karena aplikasi baru dibuka), ambil paksa dari server
    else {
        if (selectKelas) selectKelas.innerHTML = '<option value="">Memuat data...</option>';
        
        gas.run.withSuccessHandler(result => {
            if (result.success) {
                existingClasses = result.data; // Simpan ke global agar akses berikutnya cepat
                fillDropdown(existingClasses); // Render ke dropdown
            }
        }).getKelasList();
    }
}

function applyFilter() {
        const emptyState = document.getElementById('rekapEmptyState');
        const container = document.getElementById('rekapContainer');
        const loading = document.getElementById('rekapLoading');

        emptyState.classList.add('hidden');
        container.classList.add('hidden');
        loading.classList.remove('hidden');

        // UPDATE: Ambil nilai kelas juga
        const filter = {
            tanggalMulai: document.getElementById('fStart').value,
            tanggalAkhir: document.getElementById('fEnd').value,
            kelas: document.getElementById('fKelasRekap').value // BARU
        };

        gas.run.withSuccessHandler(result => {
            loading.classList.add('hidden');
            container.classList.remove('hidden');
            
            if (result.success) {
                tableState.rekap.fullData = result.data;
                processTableData('rekap');
            } else {
                 tableState.rekap.fullData = [];
                 processTableData('rekap');
            }
        }).getPresensiList(filter);
    }

// --- REKAP PRESENSI ---
    function loadRekapPresensi() {
        stopAndBack(false);
        setActiveMenu('Laporan');
        showView('view-rekap-presensi');
        
        // Reset View State
        document.getElementById('rekapEmptyState').classList.remove('hidden');
        document.getElementById('rekapContainer').classList.add('hidden');
        document.getElementById('rekapLoading').classList.add('hidden');
        tableState.rekap.fullData = [];

        // UPDATE: Populate Dropdown Kelas dari data global existingClasses
        const selectKelas = document.getElementById('fKelasRekap');
        if (selectKelas) {
            // Reset opsi, sisakan "Semua Kelas"
            selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
            
            // Masukkan data kelas yang sudah diambil saat initDashboard
            if (existingClasses && existingClasses.length > 0) {
                existingClasses.forEach(kelas => {
                    const option = document.createElement('option');
                    option.value = kelas;
                    option.textContent = kelas;
                    selectKelas.appendChild(option);
                });
            }
        }
    }

    function applyFilter() {
        const emptyState = document.getElementById('rekapEmptyState');
        const container = document.getElementById('rekapContainer');
        const loading = document.getElementById('rekapLoading');

        emptyState.classList.add('hidden');
        container.classList.add('hidden');
        loading.classList.remove('hidden');

        // UPDATE: Ambil nilai kelas juga
        const filter = {
            tanggalMulai: document.getElementById('fStart').value,
            tanggalAkhir: document.getElementById('fEnd').value,
            kelas: document.getElementById('fKelasRekap').value // BARU
        };

        gas.run.withSuccessHandler(result => {
            loading.classList.add('hidden');
            container.classList.remove('hidden');
            
            if (result.success) {
                tableState.rekap.fullData = result.data;
                processTableData('rekap');
            } else {
                 tableState.rekap.fullData = [];
                 processTableData('rekap');
            }
        }).getPresensiList(filter);
    }

    function exportToExcel() {
        const start = document.getElementById('fStart').value;
        const end = document.getElementById('fEnd').value;
        // UPDATE: Ambil nilai kelas
        const kelas = document.getElementById('fKelasRekap').value; 

        if (!start || !end) {
            showAlert('error', 'Harap pilih rentang tanggal terlebih dahulu.');
            return;
        }

        const btn = document.getElementById('btnExportExcel');
        const originalText = btn.innerHTML;
        
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Memproses...';
        
        // UPDATE: Masukkan kelas ke object filters
        const filters = {
            tanggalMulai: start,
            tanggalAkhir: end,
            kelas: kelas // BARU
        };

        gas.run.withSuccessHandler(result => {
            btn.disabled = false;
            btn.innerHTML = originalText;

            if (result.success) {
                window.open(result.url, '_blank');
                showAlert('success', 'File Excel berhasil diunduh!');
            } else {
                showAlert('error', result.message);
            }
        })
        .withFailureHandler(err => {
            btn.disabled = false;
            btn.innerHTML = originalText;
            showAlert('error', 'Terjadi kesalahan server: ' + err);
        })
        .generateExcel('laporan_presensi', filters);
    }

function renderRekapRows(data) {
    const tbody = document.getElementById('tbody-rekap');
    
    // Update colspan jadi 8 karena kolom bertambah
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-gray-400">Tidak ada data ditemukan.</td></tr>';
        return;
    }
    
    // Helper untuk warna badge STATUS (Kolom H)
    const getStatusColor = (status) => {
         if(status === 'Hadir') return 'bg-green-100 text-green-700';
         if(status === 'Izin') return 'bg-blue-100 text-blue-700';
         if(status === 'Sakit') return 'bg-yellow-100 text-yellow-700';
         if(status === 'Alpa') return 'bg-red-100 text-red-700';
         return 'bg-gray-100 text-gray-600';
    };

    tbody.innerHTML = data.map((d, i) => {
        
        // Helper untuk warna teks KETERANGAN (Kolom G)
        let ketText = d.keterangan || "-";
        let ketStyle = "text-gray-500";
        let ketIcon = "";
        
        if (String(ketText).includes("Terlambat")) {
            ketStyle = "text-rose-600 font-bold bg-rose-50 px-2 py-1 rounded border border-rose-100 text-[10px]";
            ketIcon = '<i class="fas fa-history mr-1"></i>';
        } else if (String(ketText).includes("Pulang Cepat")) {
            ketStyle = "text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-100 text-[10px]";
            ketIcon = '<i class="fas fa-running mr-1"></i>';
        } else if (ketText === "Tepat Waktu") {
            ketStyle = "text-emerald-600 font-bold text-[10px]";
            ketIcon = '<i class="fas fa-check-double mr-1"></i>';
        }

        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition">
            <td class="p-4 text-center text-gray-500 text-xs">${i + 1}</td>
            
            <td class="p-4 text-sm text-gray-600">
               ${new Date(d.tanggal).toLocaleDateString('id-ID', {day: 'numeric', month: 'short', year: 'numeric'})}
            </td>
            
            <td class="p-4 text-sm font-bold text-gray-900">${d.nama}</td>
            
            <td class="p-4 text-center text-sm text-gray-600">
               <span class="bg-gray-100 px-2 py-1 rounded text-xs font-bold">${d.kelas}</span>
            </td>
            
            <td class="p-4 text-center text-sm font-mono text-gray-600">${d.jamDatang}</td>
            <td class="p-4 text-center text-sm font-mono text-gray-600">${d.jamPulang}</td>
            
            <td class="p-4 text-center align-middle">
               <span class="${ketStyle} inline-block whitespace-nowrap">${ketIcon}${ketText}</span>
            </td>
            
            <td class="p-4 text-center text-sm">
                <span class="${getStatusColor(d.status)} px-2 py-1 rounded text-xs font-bold">
                   ${d.status || 'Hadir'}
                </span>
            </td>
        </tr>`;
    }).join('');
}

    // --- MONITORING ---
function loadMonitoringPresensi() {
    stopAndBack(false);
    setActiveMenu('Monitoring');
    showView('view-monitoring');
    document.getElementById('monitoringDate').textContent = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    
    // --- Set Default Tanggal Export ke Hari Ini ---
    const todayISO = new Date().toISOString().split('T')[0];
    const elStart = document.getElementById('exportMonStart');
    const elEnd = document.getElementById('exportMonEnd');
    if(elStart && !elStart.value) elStart.value = todayISO;
    if(elEnd && !elEnd.value) elEnd.value = todayISO;

    // --- Populate dropdown filter kelas ---
    const kelasDropdown = document.getElementById('filterKelasMonitoring');
    if (kelasDropdown) {
        kelasDropdown.style.display = '';
        if (kelasDropdown.parentElement) kelasDropdown.parentElement.style.display = '';

        // Tentukan daftar kelas yang ditampilkan di dropdown
        let kelasList = [];
        if (currentUser.role === 'guru' && currentUser.kelas) {
            // Guru: hanya kelas yang dipegang (bisa lebih dari satu)
            kelasList = String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean);
        } else {
            // Admin / Waka: semua kelas
            kelasList = existingClasses || [];
        }

        const currentVal = kelasDropdown.value;
        let opts = '<option value="">Semua Kelas</option>';
        kelasList.forEach(k => {
            opts += `<option value="${k}" ${currentVal === k ? 'selected' : ''}>${k}</option>`;
        });
        kelasDropdown.innerHTML = opts;
    }

    // Tentukan filter kelas server-side:
    // - Guru 1 kelas : kirim kelas itu sebagai filter (hemat data)
    // - Guru multi-kelas : kirim semua kelas miliknya ke server
    // - Admin/Waka : tidak filter di server (ambil semua, filter di client)
    const myClass = currentUser.role === 'guru' ? currentUser.kelas : null;

    if (tableState.monitoring.fullData.length > 0) {
        processTableData('monitoring');
    } else {
        document.getElementById('tbody-monitoring').innerHTML = '<tr><td colspan="7" class="p-8 text-center text-gray-500"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memuat data...</td></tr>';
        gas.run.withSuccessHandler(result => {
            if (result.success) {
                tableState.monitoring.fullData = result.data;
                processTableData('monitoring');
            } else {
                document.getElementById('tbody-monitoring').innerHTML = '<tr><td colspan="7" class="p-12 text-center text-gray-400 italic bg-white">Data tidak ditemukan.</td></tr>';
            }
        }).getMonitoringRealtime(myClass);
    }
}

function exportMonitoringExcel() {
    // 1. Ambil elemen tombol
    const btn = document.getElementById('btnExportMonitoring');
    const originalContent = btn.innerHTML;

    // 2. AMBIL TANGGAL DARI INPUT (BARU)
    const startDate = document.getElementById('exportMonStart').value;
    const endDate = document.getElementById('exportMonEnd').value;

    if (!startDate || !endDate) {
        showAlert('error', 'Harap pilih tanggal mulai dan akhir untuk export.');
        return;
    }

    // 3. Ubah tampilan tombol menjadi "Loading"
    btn.disabled = true;
    btn.classList.add('cursor-not-allowed', 'opacity-75');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> <span class="hidden sm:inline">Memproses...</span>';
    
    // 4. Siapkan Filter
    // Prioritas: dropdown filter kelas (jika dipilih) > kelas guru (server-side)
    const dropdownKelas = document.getElementById('filterKelasMonitoring')?.value || '';
    const myClassDefault = (currentUser && currentUser.role === 'guru') ? currentUser.kelas : null;
    const kelasForExport = dropdownKelas || myClassDefault || null;
    
    const filters = {
        kelas: kelasForExport,
        tanggalMulai: startDate,
        tanggalAkhir: endDate
    };

    // 5. Panggil Backend
    gas.run.withSuccessHandler(result => {
        btn.disabled = false;
        btn.classList.remove('cursor-not-allowed', 'opacity-75');
        btn.innerHTML = originalContent;

        if (result.success) {
            window.open(result.url, '_blank');
            showAlert('success', 'Data monitoring berhasil di-export!');
        } else {
            showAlert('error', result.message);
        }
    })
    .withFailureHandler(err => {
        btn.disabled = false;
        btn.classList.remove('cursor-not-allowed', 'opacity-75');
        btn.innerHTML = originalContent;
        showAlert('error', 'Gagal menghubungi server: ' + err);
    })
    .generateExcel('monitoring', filters);
}
    
function renderMonitoringRows(data, startIdx) {
    const tbody = document.getElementById('tbody-monitoring');
    
    // 1. Cek jika data kosong
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="p-12 text-center text-gray-400 italic bg-white">Tidak ada data ditemukan.</td></tr>';
        return;
    }

    // 2. Cek Hak Akses (Hanya Guru/Admin yang bisa edit dropdown)
    const canEdit = (currentUser.role === 'guru' || currentUser.role === 'admin');
    const cursorClass = canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70';
    const disabledAttr = canEdit ? '' : 'disabled';

    // 3. Render Baris Tabel
    tbody.innerHTML = data.map((d, i) => {
        
        // --- A. LOGIKA WARNA DROPDOWN STATUS (Kolom H) ---
        let statusColor = 'bg-gray-100 text-gray-600';
        if(d.status === 'Hadir') statusColor = 'bg-green-100 text-green-700';
        else if(d.status === 'Izin') statusColor = 'bg-blue-100 text-blue-700';
        else if(d.status === 'Sakit') statusColor = 'bg-yellow-100 text-yellow-700';
        else if(d.status === 'Alpa') statusColor = 'bg-red-100 text-red-700';

        // --- B. LOGIKA TAMPILAN KETERANGAN WAKTU (Kolom G) ---
        let ketText = d.keterangan || "-"; // Ambil teks dari server (misal: "Terlambat (15 m)")
        let ketStyle = "text-gray-400 font-mono text-[10px]"; // Default style
        let ketIcon = "";

        // Deteksi kata kunci dalam teks keterangan untuk memberi warna
        if (String(ketText).includes("Terlambat")) {
            // MERAH: Jika Terlambat
            ketStyle = "text-rose-600 font-bold bg-rose-50 px-2 py-1 rounded border border-rose-100 text-[10px]";
            ketIcon = '<i class="fas fa-history mr-1"></i>';
        } else if (String(ketText).includes("Pulang Cepat")) {
            // ORANYE: Jika Pulang Cepat
            ketStyle = "text-orange-600 font-bold bg-orange-50 px-2 py-1 rounded border border-orange-100 text-[10px]";
            ketIcon = '<i class="fas fa-running mr-1"></i>';
        } else if (ketText === "Tepat Waktu") {
            // HIJAU: Jika Tepat Waktu
            ketStyle = "text-emerald-600 font-bold text-[10px]";
            ketIcon = '<i class="fas fa-check-double mr-1"></i>';
        }

        // --- C. HTML ROW ---
        return `
        <tr class="hover:bg-gray-50 border-b border-gray-50 transition group">
            <td class="p-4 text-center text-gray-400 text-xs">${startIdx + i + 1}</td>
            
            <td class="p-4">
                <div class="font-bold text-sm text-gray-900">${d.nama}</div>
                <div class="text-xs text-gray-500 font-mono">${d.nis}</div>
            </td>
            
            <td class="p-4 text-center">
                <span class="bg-indigo-50 text-indigo-600 px-2 py-1 rounded text-xs font-bold border border-indigo-100">${d.kelas}</span>
            </td>
            
            <td class="p-4 text-center text-xs font-mono text-gray-600">${d.jamDatang}</td>
            
            <td class="p-4 text-center text-xs font-mono text-gray-600">${d.jamPulang}</td>

            <td class="p-4 text-center align-middle">
                 <span class="${ketStyle} inline-block whitespace-nowrap">${ketIcon}${ketText}</span>
            </td>

            <td class="p-4 text-center relative">
                <select onchange="changeStatus('${d.nis}', '${d.nama}', '${d.kelas}', this)" 
                        class="text-xs font-bold py-1.5 px-2 rounded-lg border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none text-center w-32 ${statusColor} ${cursorClass}"
                        ${disabledAttr}>
                    <option value="Belum Absen" ${d.status === 'Belum Absen' ? 'selected' : ''}>Belum Absen</option>
                    <option value="Hadir" ${d.status === 'Hadir' ? 'selected' : ''}>Hadir</option>
                    <option value="Izin" ${d.status === 'Izin' ? 'selected' : ''}>Izin</option>
                    <option value="Sakit" ${d.status === 'Sakit' ? 'selected' : ''}>Sakit</option>
                    <option value="Alpa" ${d.status === 'Alpa' ? 'selected' : ''}>Alpa</option>
                </select>
                ${canEdit ? '<i class="fas fa-chevron-down absolute right-6 top-1/2 transform -translate-y-1/2 text-[10px] pointer-events-none opacity-40"></i>' : ''}
            </td>
        </tr>`;
    }).join('');
}

    // Fungsi Handler saat Guru mengubah Status
function changeStatus(nis, nama, kelas, selectElement) {
    const newStatus = selectElement.value;
    
    // Visual Feedback: Disable sementara dropdown saat memproses
    selectElement.disabled = true;
    selectElement.style.opacity = '0.5';

    // --- KEAMANAN: AMBIL TOKEN USER ---
    const token = currentUser ? currentUser.token : null;
    // ----------------------------------

    gas.run.withSuccessHandler(res => {
        // Aktifkan kembali dropdown
        selectElement.disabled = false;
        selectElement.style.opacity = '1';

        if (res.success) {
            // Update Warna Dropdown secara langsung agar interaktif (UI Feedback)
            let newColor = 'bg-gray-100 text-gray-600';
            if(newStatus === 'Hadir') newColor = 'bg-green-100 text-green-700';
            else if(newStatus === 'Izin') newColor = 'bg-blue-100 text-blue-700';
            else if(newStatus === 'Sakit') newColor = 'bg-yellow-100 text-yellow-700';
            else if(newStatus === 'Alpa') newColor = 'bg-red-100 text-red-700';
            
            // Reset class dan tambahkan yang baru (pertahankan base styles)
            selectElement.className = `text-xs font-bold py-1.5 px-2 rounded-lg border-0 focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none text-center w-32 cursor-pointer ${newColor}`;
            
            // Opsional: Tampilkan notifikasi kecil
            // showAlert('success', 'Status diperbarui'); 
        } else {
            // Jika gagal (misal token expired/tidak ada hak akses)
            showAlert('error', 'Gagal update: ' + res.message);
            // Reload tabel untuk mengembalikan status asli dari server
            loadMonitoringPresensi();
        }
    })
    .withFailureHandler(error => {
        selectElement.disabled = false;
        selectElement.style.opacity = '1';
        showAlert('error', 'Error koneksi: ' + error);
    })
    .updatePresensiStatus(token, nis, nama, kelas, newStatus); // <-- Token dikirim
}
    // --- KARTU SISWA ---
function loadQRCodeSiswa(noKartuParam, namaParam, kelasParam) {
    if (typeof stopAndBack === "function") stopAndBack(false);
    if (currentUser && currentUser.role === 'siswa' && typeof setActiveMenu === "function") {
        setActiveMenu('Kartu Saya');
    }
    if (typeof showView === "function") showView('view-kartu-siswa');

    const container = document.getElementById('kartuSiswaContainer');
    if (!container) return;

    // Ambil data mentah -- QR sekarang encode No. Kartu, BUKAN NIS lagi
    // (NIS cuma dipakai buat login siswa).
    let rawKartu = noKartuParam || (currentUser ? currentUser.noKartu : "");
    const namaSiswa = namaParam || (currentUser ? currentUser.nama : "Siswa");
    const kelasSiswa = kelasParam || (currentUser ? currentUser.kelas : "X");

    if (!rawKartu) {
        container.innerHTML = `
            <div class="flex justify-center items-center h-full py-12">
                <div class="bg-white rounded-2xl shadow-xl p-8 max-w-sm text-center">
                    <i class="fas fa-id-card text-4xl text-amber-400 mb-3"></i>
                    <h3 class="font-bold text-gray-700 mb-1">No. Kartu Belum Diisi</h3>
                    <p class="text-sm text-gray-400">Hubungi admin untuk mengisi No. Kartu siswa ini dulu sebelum kartu bisa dicetak.</p>
                </div>
            </div>`;
        return;
    }
    
    // --- PERBAIKAN UTAMA: PEMBERSIH DATA (SANITIZER) ---
    // Kita hanya ambil Angka dan Huruf saja. Spasi/Simbol aneh dibuang.
    let cleanNis = String(rawKartu).replace(/[^a-zA-Z0-9]/g, "").trim();
    
    // Cek di Console panjang karakter aslinya (untuk debug)
    console.log("No. Kartu Mentah:", rawKartu, "| Panjang:", String(rawKartu).length);
    console.log("No. Kartu Bersih:", cleanNis, "| Panjang:", cleanNis.length);

    let backFunction = (currentUser && (currentUser.role === 'admin' || currentUser.role === 'guru')) 
                       ? "loadDataSiswa()" : "loadSiswaDashboard()";

    container.innerHTML = `
        <div class="flex justify-center items-center h-full py-12 animate-slide-up">
            <div class="bg-white rounded-3xl shadow-2xl overflow-hidden w-full max-w-sm relative transform hover:scale-[1.02] transition duration-300">
                <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white text-center relative">
                    <div class="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl"></div>
                    <h2 class="text-2xl font-bold tracking-tight">KARTU PRESENSI</h2>
                    <p class="text-xs tracking-[0.2em] uppercase opacity-80 mt-1">SMPN 1 ANAK RATU AJI</p>
                </div>
        
                <div class="p-8 text-center bg-gray-50">
                    <div class="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 inline-block mb-5">
                        <div id="myQrcode"></div>
                    </div>
                    <h3 class="text-2xl font-bold text-gray-800 mb-1">${namaSiswa}</h3>
                    <p class="text-indigo-600 font-mono font-bold text-lg mb-3 tracking-wider">${cleanNis}</p>
                    <span class="inline-block px-4 py-1.5 bg-gray-200 text-gray-700 rounded-full text-sm font-bold shadow-sm">${kelasSiswa}</span>
                </div>
                
                <div class="p-5 bg-white border-t border-gray-100 flex gap-4">
                    <button onclick="window.print()" class="flex-1 bg-gray-900 text-white py-3 rounded-xl font-bold text-sm shadow hover:bg-black transition flex items-center justify-center">
                        <i class="fas fa-print mr-2"></i> Cetak
                    </button>
                    <button onclick="${backFunction}" class="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-bold text-sm hover:bg-gray-50 transition">
                        Tutup
                    </button>
                </div>
            </div>
        </div>`;

    setTimeout(() => {
        const qrElement = document.getElementById("myQrcode");
        if (qrElement && cleanNis) {
            qrElement.innerHTML = ""; 
            try {
                // Hapus opsi typeNumber agar library otomatis menyesuaikan ukuran
                new QRCode(qrElement, {
                    text: cleanNis,       // Gunakan data yang sudah dibersihkan
                    width: 160,
                    height: 160,
                    colorDark: "#1f2937",
                    colorLight: "#ffffff",
                    correctLevel : QRCode.CorrectLevel.L  // Level L = Kapasitas Paling Besar
                });
            } catch (e) {
                console.error("Gagal generate QR:", e);
                qrElement.innerHTML = "<span class='text-red-500 text-xs'>Error Data</span>";
            }
        }
    }, 100);
}
// Cache data siswa di memori browser — diisi sekali saat buka halaman scan
let siswaLocalCache = {}; // { noKartu: { nama, kelas } }
let siswaLocalCacheLoaded = false;

function loadScanPresensi() {
    isScanning = false;
    setActiveMenu('Scan Presensi');
    showView('view-scanner');
    stopPolling();
    setTimeout(() => {
        const inp = document.getElementById('qrFileInput');
        if (inp) inp.value = '';
        const fr = document.getElementById('fileResult');
        if (fr) fr.innerHTML = '';
        const ps = document.getElementById('pollingStatus');
        if (ps) ps.classList.add('hidden');
    }, 100);

    // Muat cache siswa ke browser (hanya sekali, atau kalau kosong)
    if (!siswaLocalCacheLoaded) {
        const cacheStatus = document.getElementById('scanCacheStatus');
        if (cacheStatus) {
            cacheStatus.textContent = '⏳ Memuat data siswa...';
            cacheStatus.className = 'text-xs text-yellow-500';
            cacheStatus.classList.remove('hidden');
        }

        // Kalau lagi offline, langsung pakai cache tersimpan dari sesi online terakhir --
        // jangan nunggu server (bakal gagal/lama percuma).
        if (!navigator.onLine) {
            if (loadSiswaLocalCacheFromStorage() && cacheStatus) {
                cacheStatus.textContent = '📴 Offline — pakai data siswa tersimpan';
                cacheStatus.className = 'text-xs text-amber-500';
                setTimeout(() => cacheStatus.classList.add('hidden'), 3000);
            } else if (cacheStatus) {
                cacheStatus.textContent = '⚠️ Offline & belum ada data siswa tersimpan. Buka menu ini sekali saat online dulu.';
                cacheStatus.className = 'text-xs text-red-400';
            }
            return;
        }

        gas.run
            .withSuccessHandler(res => {
                if (res.success) {
                    siswaLocalCache = {};
                    res.data.forEach(s => { if (s.noKartu) siswaLocalCache[s.noKartu] = { nama: s.nama, kelas: s.kelas }; });
                    siswaLocalCacheLoaded = true;
                    // Simpan cadangan ke localStorage biar tetap bisa dipakai pas offline nanti
                    try { localStorage.setItem('siswaLocalCacheBackup', JSON.stringify(siswaLocalCache)); } catch (e) {}
                    if (cacheStatus) {
                        cacheStatus.textContent = '✅ ' + res.data.length + ' siswa siap discan';
                        cacheStatus.className = 'text-xs text-green-500';
                        setTimeout(() => cacheStatus.classList.add('hidden'), 3000);
                    }
                }
            })
            .withFailureHandler(() => {
                // Fetch gagal (server gak terjangkau) -> coba pakai cadangan localStorage
                if (loadSiswaLocalCacheFromStorage() && cacheStatus) {
                    cacheStatus.textContent = '📴 Gagal konek server — pakai data siswa tersimpan';
                    cacheStatus.className = 'text-xs text-amber-500';
                } else if (cacheStatus) {
                    cacheStatus.textContent = '⚠️ Gagal muat data, scan akan lebih lambat';
                    cacheStatus.className = 'text-xs text-red-400';
                }
            })
            .getSiswaForScanCache();
    }
}

// Ambil cadangan cache siswa dari localStorage (dipakai saat offline / server gak terjangkau).
// Return true kalau ada & berhasil dimuat.
function loadSiswaLocalCacheFromStorage() {
    try {
        const raw = localStorage.getItem('siswaLocalCacheBackup');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return false;
        siswaLocalCache = parsed;
        siswaLocalCacheLoaded = true;
        return true;
    } catch (e) {
        return false;
    }
}

    function setScanMode(mode) {}

    // ============================================================
    // CAMERA POPUP - localStorage polling (bypass GAS iframe)
    // ============================================================
    let cameraPopup = null;
    let pollingInterval = null;
    const LS_KEY = 'gas_qr_result';

    function stopPolling() {
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
        const ps = document.getElementById('pollingStatus');
        if (ps) ps.classList.add('hidden');
    }

    // Listener postMessage dari popup kamera (metode utama, lebih andal dari localStorage)
    window.addEventListener('message', function(event) {
        if (!event.data || event.data.type !== 'QR_SCAN_RESULT') return;
        var nis = event.data.nis;
        if (!nis || typeof nis !== 'string') return;
        if (event.data.ts && (Date.now() - event.data.ts) > 30000) return;
        // JANGAN tutup popup & JANGAN stop polling — biarkan kamera tetap hidup untuk antrian berikutnya
        onScanSuccess(nis);
    });

    function startPolling() {
        stopPolling();
        try { localStorage.removeItem(LS_KEY); } catch(e) {}
        const ps = document.getElementById('pollingStatus');
        if (ps) ps.classList.remove('hidden');

        pollingInterval = setInterval(() => {
            if (cameraPopup && cameraPopup.closed) {
                cameraPopup = null;
                stopPolling();
                return;
            }
            try {
                const raw = localStorage.getItem(LS_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (Date.now() - data.ts > 30000) { localStorage.removeItem(LS_KEY); return; }
                localStorage.removeItem(LS_KEY);
                // JANGAN stop polling & JANGAN tutup popup — kamera harus tetap hidup untuk antrian
                onScanSuccess(data.nis);
            } catch(e) {}
        }, 300);
    }

    function openCameraPopup() {
        try { localStorage.removeItem(LS_KEY); } catch(e) {}

        if (!DEPLOYMENT_URL) {
            showAlert('error', 'URL belum siap, coba lagi dalam 2 detik.');
            return;
        }

        const scannerUrl = new URL('scanner.html', DEPLOYMENT_URL).href;
        const lsKey = LS_KEY; // tidak dipakai lagi di sini, tapi tetap ada untuk kompatibilitas

        const lsKeyVal = LS_KEY;
        const popupHTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scan QR - E-Presensi</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:${dhMode==='pulang'?'#1c0a00':'#0f172a'};color:white;font-family:'Segoe UI',sans-serif;
       display:flex;flex-direction:column;align-items:center;
       min-height:100vh;padding:16px;gap:12px;overflow-x:hidden;}
  h2{font-size:14px;font-weight:700;color:#e2e8f0;letter-spacing:1px;margin-top:4px;}

  /* Notifikasi atas — permanen */
  #scanNotif{display:none;position:fixed;top:0;left:0;right:0;z-index:999;
    padding:11px 18px 13px;text-align:center;
    border-bottom:1px solid rgba(255,255,255,.1);
    box-shadow:0 4px 20px rgba(0,0,0,.5);}
  #scanNotif.ok {background:linear-gradient(135deg,#065f46,#047857);display:block;}
  #scanNotif.dup{background:linear-gradient(135deg,#78350f,#b45309);display:block;}
  #scanNotif.err{background:linear-gradient(135deg,#7f1d1d,#b91c1c);display:block;}
  #scanNotif.pop{animation:popIn .3s cubic-bezier(.4,0,.2,1);}
  @keyframes popIn{0%{transform:translateY(-30px);opacity:0}100%{transform:translateY(0);opacity:1}}
  .n-label{font-size:9px;text-transform:uppercase;letter-spacing:1.5px;opacity:.5;color:#fff;margin-bottom:3px;}
  .n-icon{font-size:22px;display:block;line-height:1;margin-bottom:2px;}
  .n-nama{font-size:15px;font-weight:800;color:#fff;}
  .n-detail{font-size:11px;margin-top:2px;opacity:.85;color:#fff;}

  /* Flash border */
  #flashOverlay{display:none;position:fixed;inset:0;z-index:998;pointer-events:none;border:5px solid transparent;}
  #flashOverlay.ok {display:block;border-color:#10b981;animation:ff .5s ease forwards;}
  #flashOverlay.err{display:block;border-color:#ef4444;animation:ff .5s ease forwards;}
  @keyframes ff{0%{opacity:1}100%{opacity:0}}

  #videoWrap{position:relative;width:100%;max-width:440px;}
  video{width:100%;border-radius:14px;display:block;background:#000;min-height:220px;object-fit:cover;}
  canvas{display:none;}

  .overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}
  .box{width:240px;height:240px;position:relative;}
  .corner{position:absolute;width:28px;height:28px;border-color:#6366f1;border-style:solid;}
  .tl{top:0;left:0;border-width:4px 0 0 4px;border-radius:6px 0 0 0;}
  .tr{top:0;right:0;border-width:4px 4px 0 0;border-radius:0 6px 0 0;}
  .bl{bottom:0;left:0;border-width:0 0 4px 4px;border-radius:0 0 0 6px;}
  .br{bottom:0;right:0;border-width:0 4px 4px 0;border-radius:0 0 6px 0;}
  .scanline{position:absolute;left:4px;right:4px;height:3px;
    background:linear-gradient(90deg,transparent,#818cf8,#6366f1,#818cf8,transparent);
    top:10px;border-radius:2px;animation:scan 1.6s ease-in-out infinite;}
  @keyframes scan{0%{top:6px;opacity:1}100%{top:228px;opacity:.2}}
  .box.found .corner{border-color:#4ade80;}
  .box.found .scanline{background:linear-gradient(90deg,transparent,#4ade80,transparent);}

  #status{font-size:13px;color:#94a3b8;text-align:center;max-width:360px;min-height:36px;line-height:1.6;padding:0 8px;}
  #status.ok{color:#4ade80;font-weight:700;font-size:15px;}
  #status.err{color:#f87171;}

  #tipBox{background:#1e293b;border:1px solid #334155;border-radius:10px;
    padding:10px 14px;font-size:11px;color:#94a3b8;max-width:400px;line-height:1.6;display:none;}

  .btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%;max-width:440px;}
  button{flex:1;min-width:100px;background:#4f46e5;color:white;border:none;
    padding:11px 14px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;transition:background .2s;}
  button:hover{background:#4338ca;}
  button.sec{background:#1e293b;border:1px solid #334155;}
  button.sec:hover{background:#334155;}
  button.retry{background:#059669;}
  button.retry:hover{background:#047857;}
  button.torch-on{background:#ca8a04!important;}

  #loading{color:#64748b;font-size:13px;text-align:center;}
  .spinner{width:34px;height:34px;border:3px solid #1e293b;border-top:3px solid #6366f1;
    border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px;}
  @keyframes spin{to{transform:rotate(360deg);}}
</style>
</head>
<body>

<div id="scanNotif">
  <div class="n-label">Terakhir Di-scan</div>
  <span class="n-icon" id="nIcon">✅</span>
  <div class="n-nama"   id="nNama"></div>
  <div class="n-detail" id="nDetail"></div>
</div>
<div id="flashOverlay"></div>

<h2>&#128247; SCAN QR PRESENSI</h2>

<div id="loading">
  <div class="spinner"></div>
  <span id="loadingText">Meminta izin kamera...</span>
</div>

<div id="videoWrap" style="display:none">
  <video id="video" autoplay playsinline muted></video>
  <canvas id="canvas"></canvas>
  <div class="overlay">
    <div class="box" id="aimBox">
      <div class="corner tl"></div><div class="corner tr"></div>
      <div class="corner bl"></div><div class="corner br"></div>
      <div class="scanline"></div>
    </div>
  </div>
</div>

<div id="status">Arahkan QR code ke kamera</div>
<div id="tipBox"></div>

<div class="btns" id="btns">
  <button onclick="switchCam()">&#128260; Ganti Kamera</button>
  <button class="sec" id="torchBtn" onclick="toggleTorch()" style="display:none">&#128294; Senter</button>
  <button class="sec" onclick="window.close()">&#10005; Tutup</button>
</div>

<script>
var LS_KEY='${lsKeyVal}';
var stream=null, facing='environment', scanLoop=null, lastScan=0, isSendingResult=false;
var torchOn=false, torchTrack=null;

var video    = document.getElementById('video');
var canvas   = document.getElementById('canvas');
var ctx      = canvas.getContext('2d', {willReadFrequently:true});
var statusEl = document.getElementById('status');
var loading  = document.getElementById('loading');
var loadText = document.getElementById('loadingText');
var wrap     = document.getElementById('videoWrap');
var tipBox   = document.getElementById('tipBox');
var aimBox   = document.getElementById('aimBox');

// Canvas ke-2 untuk preprocessing (kontras/grayscale)
var canvas2  = document.createElement('canvas');
var ctx2     = canvas2.getContext('2d', {willReadFrequently:true});

function showTip(m){tipBox.style.display='block';tipBox.innerHTML=m;}
function hideTip(){tipBox.style.display='none';}

// ── Buka kamera (getUserMedia — sama seperti versi lama yang jalan) ──
async function startCam(f){
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    if(scanLoop){ clearInterval(scanLoop); scanLoop=null; }
    loading.style.display='block'; wrap.style.display='none';
    hideTip(); statusEl.className='';
    torchOn=false; torchTrack=null;
    document.getElementById('torchBtn').style.display='none';
    loadText.textContent='Meminta izin kamera...';

    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)
      throw {name:'NotSupportedError',message:'Browser tidak mendukung kamera. Gunakan Chrome/Edge terbaru.'};

    loadText.textContent='Membuka kamera...';
    // Minta resolusi tinggi + autofocus
    stream = await navigator.mediaDevices.getUserMedia({video:{
      facingMode: f==='environment'?{ideal:'environment'}:'user',
      width:{ideal:1920}, height:{ideal:1080},
      advanced:[{focusMode:'continuous'},{zoom:1}]
    }});
    video.srcObject = stream;
    await new Promise((res,rej)=>{
      video.onloadedmetadata=()=>video.play().then(res).catch(rej);
      setTimeout(()=>rej({name:'TimeoutError',message:'Kamera tidak merespons.'}),8000);
    });

    // Cek torch
    var tracks = stream.getVideoTracks();
    if(tracks.length>0){
      var caps = tracks[0].getCapabilities?tracks[0].getCapabilities():{};
      if(caps.torch){ torchTrack=tracks[0]; document.getElementById('torchBtn').style.display='flex'; }
    }

    loading.style.display='none';
    wrap.style.display='block';
    statusEl.textContent='Arahkan QR ke kamera — tidak perlu posisi tepat';
    beginScan();
  }catch(e){
    loading.style.display='none';
    statusEl.className='err';
    var msg='', tip='';
    if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError'){
      msg='&#128683; Izin kamera ditolak';
      tip='<b>Cara mengizinkan:</b><br>1. Klik ikon &#128274; di URL bar<br>2. Pilih <b>Izinkan kamera</b><br>3. Klik Coba Lagi';
    }else if(e.name==='NotFoundError'){
      msg='&#128247; Kamera tidak ditemukan';
      tip='Pastikan perangkat memiliki kamera dan tidak dipakai aplikasi lain.';
    }else if(e.name==='NotReadableError'){
      msg='&#128247; Kamera dipakai aplikasi lain';
      tip='Tutup Zoom/Teams/dll lalu klik Coba Lagi.';
    }else if(e.name==='NotSupportedError'||e.name==='TimeoutError'){
      msg='&#9888; '+e.message;
      tip='Gunakan Chrome/Edge terbaru via HTTPS.';
    }else{
      msg='Gagal: '+(e.message||e.name||'Error');
      tip='Klik Coba Lagi atau ganti browser.';
    }
    statusEl.innerHTML=msg;
    showTip(tip);
    document.getElementById('btns').innerHTML=
      '<button class="retry" onclick="startCam(facing)">&#128260; Coba Lagi</button>'+
      '<button class="sec" onclick="window.close()">&#10005; Tutup</button>';
  }
}

function switchCam(){ facing=facing==='environment'?'user':'environment'; startCam(facing); }

async function toggleTorch(){
  if(!torchTrack)return;
  torchOn=!torchOn;
  try{
    await torchTrack.applyConstraints({advanced:[{torch:torchOn}]});
    var btn=document.getElementById('torchBtn');
    btn.textContent=torchOn?'&#128294; Senter ON':'&#128294; Senter';
    btn.className=torchOn?'torch-on':'sec';
  }catch(e){ torchOn=!torchOn; }
}

// ── Scan engine: multi-pass per 120ms ────────────────────────
// Coba 4 variasi gambar tiap frame → jauh lebih sensitif
function beginScan(){
  if(typeof ZXing!=='undefined'){
    runWithZXing();
  } else {
    // Muat ZXing async (tidak blokir kamera)
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    s.onload=function(){ runWithZXing(); };
    s.onerror=function(){ runWithJsQR(); }; // fallback jsQR jika CDN gagal
    document.head.appendChild(s);
  }
}

// ZXing decode dari canvas — sangat kuat, pakai TRY_HARDER
function runWithZXing(){
  try{
    var hints=new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true);
    var reader = new ZXing.BrowserQRCodeReader(hints);

    scanLoop=setInterval(function(){
      if(video.readyState<video.HAVE_ENOUGH_DATA||isSendingResult)return;
      var W=video.videoWidth, H=video.videoHeight;
      canvas.width=W; canvas.height=H;
      ctx.drawImage(video,0,0,W,H);

      // Pass 1: gambar asli
      tryZXing(reader, canvas, W, H, false) ||
      // Pass 2: kontras tinggi
      tryZXingFilter(reader, W, H, 'contrast(2) brightness(1.15)') ||
      // Pass 3: grayscale + kontras ekstrem
      tryZXingFilter(reader, W, H, 'grayscale(1) contrast(3)') ||
      // Pass 4: crop tengah 65%
      tryZXingCrop(reader, W, H);
    }, 120);
  }catch(e){
    runWithJsQR(); // fallback
  }
}

function tryZXing(reader, cvs, W, H, fromCrop){
  try{
    var lum = new ZXing.HTMLCanvasElementLuminanceSource(cvs);
    var bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
    var result = reader.decodeBitmap(bmp);
    if(result&&result.getText()){ onDetected(result.getText()); return true; }
  }catch(e){}
  return false;
}

function tryZXingFilter(reader, W, H, filter){
  try{
    canvas2.width=W; canvas2.height=H;
    ctx2.filter=filter;
    ctx2.drawImage(video,0,0,W,H);
    ctx2.filter='none';
    return tryZXing(reader, canvas2, W, H, false);
  }catch(e){ return false; }
}

function tryZXingCrop(reader, W, H){
  try{
    var cw=Math.round(W*0.65), ch=Math.round(H*0.65);
    var cx=Math.round((W-cw)/2), cy=Math.round((H-ch)/2);
    canvas2.width=cw; canvas2.height=ch;
    ctx2.filter='none';
    ctx2.drawImage(video,cx,cy,cw,ch,0,0,cw,ch);
    return tryZXing(reader, canvas2, cw, ch, true);
  }catch(e){ return false; }
}

// Fallback jsQR (jika ZXing CDN gagal muat)
function runWithJsQR(){
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  s.onload=function(){
    scanLoop=setInterval(function(){
      if(video.readyState<video.HAVE_ENOUGH_DATA||isSendingResult)return;
      var W=video.videoWidth, H=video.videoHeight;
      canvas.width=W; canvas.height=H;
      ctx.drawImage(video,0,0,W,H);
      var d=ctx.getImageData(0,0,W,H);
      var r=jsQR(d.data,W,H,{inversionAttempts:'attemptBoth'});
      if(r&&r.data) onDetected(r.data);
    },120);
  };
  document.head.appendChild(s);
}

function onDetected(text){
  var now=Date.now();
  if(now-lastScan<3000)return;
  lastScan=now;
  // Flash kotak hijau
  aimBox.classList.add('found');
  setTimeout(()=>aimBox.classList.remove('found'),600);
  handleResult(text);
}

// ── Notifikasi dari parent ────────────────────────────────────
window.addEventListener('message',function(ev){
  if(!ev.data)return;
  if(ev.data.type==='SCAN_SUCCESS')
    showScanNotif('ok','✅',ev.data.nama,ev.data.kelas+' • Berhasil ditambahkan');
  else if(ev.data.type==='SCAN_DUPLICATE')
    showScanNotif('dup','⚠️',ev.data.nama||'Sudah terscan',(ev.data.kelas?ev.data.kelas+' • ':'')+'Sudah ada di antrian');
  else if(ev.data.type==='SCAN_ERROR')
    showScanNotif('err','❌','NIS Tidak Dikenal',ev.data.message||'Siswa tidak ditemukan');
});

function showScanNotif(type,icon,nama,detail){
  var n=document.getElementById('scanNotif');
  var f=document.getElementById('flashOverlay');
  if(!n)return;
  document.getElementById('nIcon').textContent=icon;
  document.getElementById('nNama').textContent=nama;
  document.getElementById('nDetail').textContent=detail;
  n.className=''; void n.offsetWidth; n.className=type+' pop';
  if(f){ f.className=''; void f.offsetWidth; f.className=type==='ok'?'ok':'err';
    setTimeout(()=>f.className='',550); }
}

// ── Kirim ke parent ───────────────────────────────────────────
function handleResult(text){
  if(!text||text.trim()===''||isSendingResult)return;
  isSendingResult=true;
  statusEl.className='ok';
  statusEl.textContent='&#10003; Terdeteksi! Mengirim...';
  var payload={nis:text.trim(),ts:Date.now()};
  try{ if(window.opener&&!window.opener.closed)
    window.opener.postMessage({type:'QR_SCAN_RESULT',nis:text.trim(),ts:Date.now()},'*');
  }catch(e){}
  try{ localStorage.setItem(LS_KEY,JSON.stringify(payload)); }catch(e){}
  setTimeout(function(){
    statusEl.className='';
    statusEl.textContent='Siap scan siswa berikutnya...';
    isSendingResult=false;
    lastScan=Date.now();
  },2000);
}

// Mulai!
startCam(facing);
<\/script>
</body>
</html>`;

        // Buka blank window lalu tulis popupHTML langsung ke dalamnya
        // (blank window mewarisi origin parent → localStorage bisa dibagi)
        const w = Math.min(500, screen.width - 40);
        const h = Math.min(680, screen.height - 60);
        const left = Math.round((screen.width - w) / 2);
        const top = Math.round((screen.height - h) / 2);

        cameraPopup = window.open('', 'qr_cam', `width=${w},height=${h},top=${top},left=${left},resizable=yes`);

        if (!cameraPopup) {
            showAlert('error', 'Tab diblokir! Klik ikon di URL bar → Izinkan popup, lalu coba lagi.');
            return;
        }

        // Tulis HTML kamera langsung ke popup (inilah perbaikan utama)
        try {
            cameraPopup.document.open();
            cameraPopup.document.write(popupHTML);
            cameraPopup.document.close();
        } catch(e) {
            // Fallback: buka sebagai data URI jika document.write diblokir
            const blob = new Blob([popupHTML], { type: 'text/html' });
            const blobUrl = URL.createObjectURL(blob);
            cameraPopup.location.href = blobUrl;
        }

        startPolling();
    }

    function scanFromFile(input) {
        if (!input.files || !input.files[0]) return;
        const resDiv = document.getElementById('fileResult');
        resDiv.innerHTML = `<div class="text-center text-indigo-600 text-sm py-3 animate-pulse"><i class="fas fa-circle-notch fa-spin mr-2"></i>Memindai QR...</div>`;
        Html5Qrcode.scanFile(input.files[0], true)
            .then(decodedText => { resDiv.innerHTML = ''; onScanSuccess(decodedText); })
            .catch(() => { resDiv.innerHTML = `<div class="bg-red-50 text-red-600 p-3 rounded-xl border border-red-100 text-xs text-center">QR tidak terdeteksi. Coba foto lebih dekat.</div>`; });
        input.value = '';
    }

    function submitManualNis() {
        const nis = document.getElementById('manualNis')?.value?.trim();
        if (!nis) { showAlert('error', 'Masukkan No. Kartu terlebih dahulu'); return; }
        document.getElementById('manualNis').value = '';
        onScanSuccess(nis);
    }

function onScanSuccess(decodedText) {
    if (!decodedText || decodedText.trim() === "" || decodedText === "undefined") return;
    if (isScanning) return;

    const key = String(decodedText).replace(/[^a-zA-Z0-9]/g, '').trim();

    // Cegah scan duplikat
    if (scanLiveMap[key]) {
        if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
        highlightScanRow(scanLiveMap[key], document.getElementById('scanTableWrapper'));
        if (cameraPopup && !cameraPopup.closed) {
            const tr = scanLiveMap[key];
            const namaEl  = tr ? tr.querySelector('td:nth-child(2) .font-bold') : null;
            const kelasEl = tr ? tr.querySelector('td:nth-child(3) span') : null;
            try { cameraPopup.postMessage({ type: 'SCAN_DUPLICATE', nama: namaEl ? namaEl.textContent : key, kelas: kelasEl ? kelasEl.textContent : '' }, '*'); } catch(e) {}
        }
        return;
    }

    isScanning = true;

    if (siswaLocalCacheLoaded && Object.keys(siswaLocalCache).length > 0) {
        // ✅ Lookup lokal — instan tanpa server
        const found = siswaLocalCache[key];
        isScanning = false;
        if (found) {
            if (typeof dhPlayBeep === 'function') dhPlayBeep('success'); // Bunyi langsung — tidak menunggu server
            processScanPresensi(key, found.nama, found.kelas);
            if (cameraPopup && !cameraPopup.closed) {
                try { cameraPopup.postMessage({ type: 'SCAN_SUCCESS', nama: found.nama, kelas: found.kelas }, '*'); } catch(e) {}
            }
        } else {
            if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
            showAlert('error', 'No. Kartu [' + key + '] tidak terdaftar');
            if (cameraPopup && !cameraPopup.closed) {
                try { cameraPopup.postMessage({ type: 'SCAN_ERROR', message: 'No. Kartu tidak terdaftar' }, '*'); } catch(e) {}
            }
        }
    } else {
        // ⏳ Fallback ke server jika cache belum siap
        gas.run
            .withSuccessHandler(result => {
                isScanning = false;
                if (result.success) {
                    if (typeof dhPlayBeep === 'function') dhPlayBeep('success');
                    processScanPresensi(key, result.nama, result.kelas);
                    if (cameraPopup && !cameraPopup.closed) {
                        try { cameraPopup.postMessage({ type: 'SCAN_SUCCESS', nama: result.nama, kelas: result.kelas }, '*'); } catch(e) {}
                    }
                } else {
                    if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
                    showAlert('error', result.message || 'No. Kartu tidak ditemukan');
                    if (cameraPopup && !cameraPopup.closed) {
                        try { cameraPopup.postMessage({ type: 'SCAN_ERROR', message: result.message || 'No. Kartu tidak ditemukan' }, '*'); } catch(e) {}
                    }
                }
            })
            .withFailureHandler(err => {
                isScanning = false;
                if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
                if (!navigator.onLine) {
                    showAlert('error', 'Offline & belum ada data siswa tersimpan di perangkat ini. Buka menu Scan Presensi sekali saat online dulu.');
                } else {
                    showAlert('error', 'Error lookup: ' + (err.message || String(err)));
                }
            })
            .lookupSiswaForScan(key);
    }
}

    // Kirim LANGSUNG ke server begitu QR terbaca. Kalau lagi offline, server gak terjangkau,
    // atau antrean sudah menumpuk, otomatis disimpan ke antrean lokal -> dikirim lewat menu Sinkron Data.
    function processScanPresensi(nis, nama, kelas) {
        addToScanQueue({ nis: nis, nama: nama, kelas: kelas, pending: true });

        const myRole  = currentUser ? currentUser.role  : '';
        const myKelas = currentUser ? currentUser.kelas : '';
        // Jam ASLI saat kartu ditap -- dikirim ke server (bukan jam server saat request
        // diproses), penting kalau data ini sempat ketunda & masuk antrean lokal dulu.
        const jamAksiISO = new Date().toISOString();

        queueOfflineAction('Absen Masuk/Pulang', 'scanPresensi', [nis, myRole, myKelas, jamAksiISO], `${nama} (${kelas})`, 'direct-first')
            .then(outcome => {
                if (outcome.viaServer) {
                    const res = outcome.result;
                    if (res && res.success) {
                        markScanRowSuccess(nis, res);
                    } else {
                        if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
                        markScanRowError(nis, (res && res.message) || 'Gagal menyimpan');
                    }
                } else {
                    // Offline / server gak terjangkau -> tersimpan di perangkat, nunggu sinkron
                    markScanRowQueuedOffline(nis);
                }
            });
    }

    function showScanModal(content) {}
    function closeScanModal() { isScanning = false; }

    // ==========================================================================
    // SCAN KOLEKTIF — antrian lokal, kirim sekaligus ke server
    // ==========================================================================

    function addToScanQueue(siswa) {
        const tbody   = document.getElementById('tbody-scan-live');
        const wrapper = document.getElementById('scanTableWrapper');
        if (!tbody) return;

        const emptyRow = document.getElementById('scan-empty-row');
        if (emptyRow) emptyRow.remove();

        scanLiveCount++;
        const tr = document.createElement('tr');
        tr.className = 'border-b border-gray-50 transition-colors duration-700 scan-row-highlight';
        tr.setAttribute('data-nis', siswa.nis);
        tr.innerHTML = `
            <td class="px-3 py-3 text-center text-xs text-gray-400 font-mono">${scanLiveCount}</td>
            <td class="px-4 py-3">
                <div class="font-bold text-sm text-gray-900">${siswa.nama}</div>
                <div class="text-[10px] text-gray-400 font-mono">${siswa.nis}</div>
            </td>
            <td class="px-3 py-3 text-center">
                <span class="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold border border-indigo-100">${siswa.kelas}</span>
            </td>
            <td class="px-3 py-3 text-center" id="scan-status-${siswa.nis}">
                <span class="inline-flex items-center gap-1.5 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
                    <i class="fas fa-circle-notch fa-spin"></i> Menyimpan...
                </span>
            </td>
        `;

        tbody.appendChild(tr);
        scanLiveMap[siswa.nis] = tr;

        const badge = document.getElementById('scanCountBadge');
        if (badge) badge.textContent = scanLiveCount + ' Siswa';
        highlightScanRow(tr, wrapper);
    }

    // Update baris setelah server berhasil menyimpan presensi (masuk/pulang otomatis terdeteksi)
    function markScanRowSuccess(nis, res) {
        const cell = document.getElementById('scan-status-' + nis);
        if (!cell) return;
        const jam  = res.jamDatang || res.jamPulang || '';
        const tipe = res.type === 'pulang' ? 'Pulang' : 'Masuk';
        const badgeColor = res.type === 'pulang' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100';
        cell.innerHTML = `
            <span class="inline-flex items-center gap-1.5 text-[10px] font-bold ${badgeColor} px-2 py-1 rounded-lg border">
                <i class="fas fa-check-circle"></i> ${tipe} ${jam ? '· ' + jam : ''}
            </span>
        `;
    }

    // Update baris jika penyimpanan ke server gagal (mis. sudah pernah absen, di luar jam, dll)
    function markScanRowError(nis, message) {
        const cell = document.getElementById('scan-status-' + nis);
        if (!cell) return;
        cell.innerHTML = `
            <span class="inline-flex items-center gap-1.5 text-[10px] font-bold bg-red-50 text-red-600 px-2 py-1 rounded-lg border border-red-100" title="${(message || '').replace(/"/g, '&quot;')}">
                <i class="fas fa-times-circle"></i> Gagal
            </span>
        `;
    }

    // Data ke server gak terkirim (offline / server gak terjangkau) -> tersimpan di antrean lokal
    function markScanRowQueuedOffline(nis) {
        const cell = document.getElementById('scan-status-' + nis);
        if (!cell) return;
        cell.innerHTML = `
            <span class="inline-flex items-center gap-1.5 text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-1 rounded-lg border border-amber-100" title="Tersimpan di perangkat, klik Sinkron Data untuk kirim ke server">
                <i class="fas fa-cloud-upload-alt"></i> Tersimpan di Perangkat
            </span>
        `;
    }

    function removeScanRow(btn, nis) {
        const tr = btn.closest('tr');
        if (!tr) return;
        tr.remove();
        delete scanLiveMap[nis];

        const rows = document.querySelectorAll('#tbody-scan-live tr[data-nis]');
        rows.forEach((r, i) => { r.cells[0].textContent = i + 1; });
        scanLiveCount = rows.length;

        const badge = document.getElementById('scanCountBadge');
        if (badge) badge.textContent = scanLiveCount + ' Siswa';

        if (scanLiveCount === 0) {
            const tbody = document.getElementById('tbody-scan-live');
            tbody.innerHTML = `<tr id="scan-empty-row"><td colspan="4" class="py-16 text-center">
                <div class="flex flex-col items-center gap-3">
                    <i class="fas fa-qrcode text-5xl text-gray-200"></i>
                    <p class="font-semibold text-sm text-gray-400">Belum ada siswa yang discan</p>
                    <p class="text-xs text-gray-300">Scan QR — tersimpan di perangkat, kirim lewat Sinkron</p>
                </div></td></tr>`;
        }
    }

    function updateBatchBtn() {
        const btn   = document.getElementById('btnSubmitBatch');
        const label = document.getElementById('btnSubmitBatchLabel');
        if (!btn) return;
        if (scanLiveCount > 0) {
            btn.disabled = false;
            btn.style.pointerEvents = '';
            btn.className = 'w-full py-4 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow-md shadow-emerald-200';
            label.textContent = `Kirim Presensi (${scanLiveCount} Siswa)`;
        } else {
            btn.disabled = true;
            btn.style.pointerEvents = 'none';
            btn.className = 'w-full py-4 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 bg-gray-200 text-gray-400 cursor-not-allowed';
            label.textContent = 'Kirim Presensi (0 Siswa)';
        }
    }

    function submitBatchPresensi() {
        if (scanLiveCount === 0) return;

        const rows = document.querySelectorAll('#tbody-scan-live tr[data-nis]');
        const nisList = Array.from(rows).map(r => r.getAttribute('data-nis'));

        const myRole  = currentUser ? currentUser.role  : '';
        const myKelas = currentUser ? currentUser.kelas : '';
        const jamAksiISO = new Date().toISOString();

        Swal.fire({
            title: `Kirim ${nisList.length} Presensi?`,
            html: `<p style="color:#6b7280;font-size:13px">Data akan dikirim sekaligus ke server dan dicatat secara permanen.</p>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#059669',
            cancelButtonColor: '#6b7280',
            confirmButtonText: '\u2713 Ya, Kirim Sekarang',
            cancelButtonText: 'Batal'
        }).then(res => {
            if (!res.isConfirmed) return;
            showLoading();
            queueOfflineAction('Absen Massal (Batch)', 'batchScanPresensi', [nisList, myRole, myKelas, jamAksiISO], `${nisList.length} siswa`, true)
                .then(outcome => {
                    hideLoading();
                    if (outcome.viaServer) {
                        const result = outcome.result;
                        if (result.success) {
                            showBatchResultModal(result.results);
                            resetScanTable();
                        } else {
                            Swal.fire('Gagal', result.message, 'error');
                        }
                    } else {
                        Swal.fire('Tersimpan di Perangkat', `${nisList.length} data disimpan di perangkat. Buka menu "Sinkron Data" lalu klik Sinkron untuk mengirim ke server.`, 'info');
                        resetScanTable();
                    }
                });
        });
    }

    function showBatchResultModal(results) {
        const berhasil = results.filter(r => r.success);
        const gagal    = results.filter(r => !r.success);

        const berhasilHtml = berhasil.map(r =>
            `<div class="flex items-center gap-2 py-1 border-b border-gray-50">
                <span class="text-emerald-500 text-xs">\u2713</span>
                <div class="flex-1 text-left"><span class="font-semibold text-xs text-gray-800">${r.nama}</span> <span class="text-[10px] text-gray-400">(${r.kelas})</span></div>
                <span class="text-[10px] text-gray-400 font-mono">${r.jamDatang || r.jamPulang || ''}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded ${r.type==='datang' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}">${r.type==='datang' ? 'Masuk' : 'Pulang'}</span>
            </div>`
        ).join('');

        const gagalHtml = gagal.length > 0 ? `
            <div class="mt-3 bg-red-50 rounded-xl p-3 border border-red-100">
                <p class="text-xs font-bold text-red-600 mb-2"><i class="fas fa-exclamation-triangle mr-1"></i> ${gagal.length} Gagal</p>
                ${gagal.map(r => `<div class="text-xs text-red-500 py-0.5">\u2022 ${r.nama || r.nis}: ${r.message}</div>`).join('')}
            </div>` : '';

        Swal.fire({
            title: `<span style="font-size:18px">\u2705 Presensi Tersimpan</span>`,
            html: `
                <div style="text-align:center;margin-bottom:12px">
                    <span style="font-size:13px;color:#6b7280">${berhasil.length} dari ${results.length} data berhasil disimpan</span>
                </div>
                <div style="max-height:300px;overflow-y:auto;text-align:left;padding:0 4px">
                    ${berhasilHtml}
                </div>
                ${gagalHtml}`,
            icon: berhasil.length === results.length ? 'success' : 'warning',
            confirmButtonText: 'Tutup',
            confirmButtonColor: '#111827',
        });
    }

    function highlightScanRow(tr, wrapper) {
        document.querySelectorAll('.scan-row-highlight').forEach(el => el.classList.remove('scan-row-highlight'));
        tr.classList.add('scan-row-highlight');
        const wrapperEl = wrapper || document.getElementById('scanTableWrapper');
        if (wrapperEl && tr) {
            wrapperEl.scrollTo({ top: tr.offsetTop - (wrapperEl.clientHeight / 2) + (tr.offsetHeight / 2), behavior: 'smooth' });
        }
        setTimeout(() => tr.classList.remove('scan-row-highlight'), 3000);
    }

    function resetScanTable() {
        const tbody = document.getElementById('tbody-scan-live');
        if (!tbody) return;
        tbody.innerHTML = `<tr id="scan-empty-row"><td colspan="4" class="py-16 text-center">
            <div class="flex flex-col items-center gap-3">
                <i class="fas fa-qrcode text-5xl text-gray-200"></i>
                <p class="font-semibold text-sm text-gray-400">Belum ada siswa yang discan</p>
                <p class="text-xs text-gray-300">Scan QR — tersimpan di perangkat, kirim lewat Sinkron</p>
            </div></td></tr>`;
        scanLiveCount = 0;
        scanLiveMap   = {};
        const badge = document.getElementById('scanCountBadge');
        if (badge) badge.textContent = '0 Siswa';
    }

    function updateScanLiveTable() {}

    function stopAndBack(redirect = true) {
        stopPolling();
        if (cameraPopup && !cameraPopup.closed) { cameraPopup.close(); cameraPopup = null; }
        if (html5QrCode) { try { html5QrCode.stop().catch(() => {}); } catch(e) {} html5QrCode = null; }
        isScanning = false;
        if (redirect && currentUser) returnToDashboard();
    }
    function returnToDashboard() {
        if(currentUser.role === 'admin') loadAdminDashboard();
        else if(currentUser.role === 'guru') loadGuruDashboard();
        else loadSiswaDashboard();
    }

    // --- MODALS ---
    function showLoading() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
    function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

    function showModal(content) {
        const container = document.getElementById('modalContainer');
        container.innerHTML = `
            <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" onclick="closeModal()"></div>
                <div class="relative w-full max-w-2xl transform transition-all animate-fade-in">
                    ${content}
                </div>
            </div>`;
    }

    function closeModal() { document.getElementById('modalContainer').innerHTML = ''; }

    function showAlert(type, message) {
        const bg = type === 'success' ? 'bg-green-600' : 'bg-red-600';
        const div = document.createElement('div');
        div.className = `fixed top-6 right-6 ${bg} text-white px-6 py-4 rounded-xl shadow-2xl z-[80] flex items-center font-medium animate-fade-in transform translate-y-2`;
        div.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'} mr-3 text-xl"></i> ${message}`;
        document.body.appendChild(div);
        setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 3000);
    }

    // --- MODAL GENERATORS (SISWA & GURU) ---
    function showAddSiswaModal() { showModal(createSiswaModal()); }
    function editSiswa(s) { showModal(createSiswaModal(s)); }
    
    function showAddGuruModal() { showModal(createGuruModal()); }
    function editGuru(guruData) { showModal(createGuruModal(guruData)); }

    function createSiswaModal(s = null) {
        const isEdit = s !== null;
        const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 transition-all";
        const labelClass = "block mb-1 text-xs font-bold text-gray-500 uppercase tracking-wide";
        
        return `
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div class="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-800">${isEdit ? 'Edit Data Siswa' : 'Registrasi Siswa Baru'}</h3>
                <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times text-lg"></i></button>
            </div>
            <div class="p-6 max-h-[75vh] overflow-y-auto">
                <form onsubmit="saveSiswa(event, ${isEdit})" class="space-y-5">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div class="md:col-span-2">
                            <label class="${labelClass}">Nama Lengkap</label>
                            <input type="text" name="nama" value="${s?.nama || ''}" required class="${inputClass}" placeholder="Sesuai Akta Kelahiran">
                        </div>
                        <div>
                            <label class="${labelClass}">NIS <span class="normal-case text-gray-400 font-normal">(buat login siswa)</span></label>
                            <input type="number" name="nis" value="${s?.nis || ''}" required ${isEdit ? 'readonly class="' + inputClass + ' opacity-60 cursor-not-allowed"' : `class="${inputClass}"`} placeholder="Nomor Induk">
                        </div>
                        
                        <div class="relative group">
                            <label class="${labelClass}">Kelas</label>
                            <input type="text" name="kelas" id="inputKelas" 
                                value="${s?.kelas || ''}" 
                                required 
                                class="${inputClass}" 
                                placeholder="Ketik atau pilih kelas" 
                                autocomplete="off"
                                onfocus="openKelasDropdown()"
                                oninput="filterKelasDropdown(this.value)"
                                onblur="closeKelasDropdown()">
                            <div id="dropdownKelasList" class="hidden absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto mt-1 scrollbar-hide"></div>
                        </div>

                        <div>
                            <label class="${labelClass}">No. Absen</label>
                            <input type="number" name="noAbsen" value="${s?.noAbsen || ''}" class="${inputClass}" placeholder="Nomor Urut Absen">
                        </div>

                        <div class="md:col-span-2">
                            <label class="${labelClass}">No. Kartu <span class="normal-case text-gray-400 font-normal">(dicetak jadi QR, dipakai buat scan/tap presensi)</span></label>
                            <input type="text" name="noKartu" value="${s?.noKartu || ''}" class="${inputClass}" placeholder="Kode di kartu fisik siswa, cth: A001" autocomplete="off">
                        </div>

                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                        <div>
                            <label class="${labelClass}">Jenis Kelamin</label>
                            <select name="jenisKelamin" class="${inputClass}">
                                <option value="Laki-laki" ${s?.jenisKelamin === 'Laki-laki' ? 'selected' : ''}>Laki-laki</option>
                                <option value="Perempuan" ${s?.jenisKelamin === 'Perempuan' ? 'selected' : ''}>Perempuan</option>
                            </select>
                        </div>
                        <div>
                            <label class="${labelClass}">Tanggal Lahir</label>
                            <input type="date" name="tanggalLahir" value="${s?.tanggalLahir || ''}" required class="${inputClass}">
                        </div>
                        <div>
                            <label class="${labelClass}">Agama</label>
                            <select name="agama" class="${inputClass}">
                                <option value="Islam" ${s?.agama === 'Islam' ? 'selected' : ''}>Islam</option>
                                <option value="Kristen" ${s?.agama === 'Kristen' ? 'selected' : ''}>Kristen</option>
                                <option value="Katolik" ${s?.agama === 'Katolik' ? 'selected' : ''}>Katolik</option>
                                <option value="Hindu" ${s?.agama === 'Hindu' ? 'selected' : ''}>Hindu</option>
                                <option value="Buddha" ${s?.agama === 'Buddha' ? 'selected' : ''}>Buddha</option>
                                <option value="Lainnya" ${s?.agama === 'Lainnya' ? 'selected' : ''}>Lainnya</option>
                            </select>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-5 bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <div>
                            <label class="${labelClass}">Nama Ayah</label>
                            <input type="text" name="namaAyah" value="${s?.namaAyah || ''}" class="${inputClass}">
                        </div>
                        <div>
                            <label class="${labelClass}">Nama Ibu</label>
                            <input type="text" name="namaIbu" value="${s?.namaIbu || ''}" class="${inputClass}">
                        </div>
                        <div>
                            <label class="${labelClass}">No. Handphone</label>
                            <input type="tel" name="noHp" value="${s?.noHp || ''}" class="${inputClass}">
                        </div>
                    </div>
                    <div>
                        <label class="${labelClass}">Alamat Lengkap</label>
                        <textarea name="alamat" rows="2" class="${inputClass}">${s?.alamat || ''}</textarea>
                    </div>
                    <div class="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button type="button" onclick="closeModal()" class="px-6 py-2.5 rounded-xl text-gray-600 font-medium hover:bg-gray-100 transition">Batal</button>
                        <button type="submit" class="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition transform active:scale-95">Simpan Data</button>
                    </div>
                    ${isEdit ? `<input type="hidden" name="oldNis" value="${s.nis}">` : ''}
                </form>
            </div>
        </div>`;
    }

// Fungsi Trigger untuk menampilkan modal
    function viewSiswa(siswa) {
        showModal(createViewSiswaModal(siswa));
    }

    // Fungsi Generator HTML Modal Detail
    function createViewSiswaModal(s) {
        // Helper untuk styling label dan value agar rapi
        const item = (label, value, icon) => `
            <div class="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <div class="flex items-center gap-2 mb-1">
                    <i class="fas ${icon} text-gray-400 text-xs"></i>
                    <span class="text-[10px] uppercase font-bold text-gray-500 tracking-wider">${label}</span>
                </div>
                <div class="text-sm font-bold text-gray-800 break-words">${value || '-'}</div>
            </div>
        `;

        return `
        <div class="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full animate-fade-in relative">
            
            <div class="bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white flex justify-between items-start">
                <div class="flex gap-4 items-center">
                    <div class="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-2xl font-bold border-2 border-white/30 shadow-inner">
                        ${s.nama.charAt(0)}
                    </div>
                    <div>
                        <h3 class="text-xl font-bold tracking-tight">${s.nama}</h3>
                        <p class="opacity-90 text-sm flex items-center gap-2">
                            <i class="far fa-id-card"></i> ${s.nis}
                            <span class="bg-white/20 px-2 py-0.5 rounded text-xs font-bold ml-2">${s.kelas}</span>
                        </p>
                    </div>
                </div>
                <button onclick="closeModal()" class="bg-white/10 hover:bg-white/20 p-2 rounded-lg transition text-white">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="p-6 max-h-[70vh] overflow-y-auto">
                
                <div class="mb-6">
                    <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                        <i class="fas fa-user-circle"></i> Data Pribadi
                    </h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        ${item('Jenis Kelamin', s.jenisKelamin, 'fa-venus-mars')}
                        ${item('Tanggal Lahir', s.tanggalLahir, 'fa-birthday-cake')}
                        ${item('Agama', s.agama, 'fa-pray')}
                        ${item('No. Handphone', s.noHp, 'fa-phone')}
                    </div>
                </div>

                <div class="mb-6">
                    <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                        <i class="fas fa-users"></i> Data Orang Tua
                    </h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        ${item('Nama Ayah', s.namaAyah, 'fa-male')}
                        ${item('Nama Ibu', s.namaIbu, 'fa-female')}
                    </div>
                </div>

                <div>
                    <h4 class="text-sm font-bold text-emerald-700 mb-3 flex items-center gap-2">
                        <i class="fas fa-map-marker-alt"></i> Alamat Lengkap
                    </h4>
                    <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 flex gap-3 items-start">
                        <i class="fas fa-home text-gray-400 mt-1"></i>
                        <p class="text-sm text-gray-700 leading-relaxed font-medium">
                            ${s.alamat || 'Alamat belum diisi.'}
                        </p>
                    </div>
                </div>

            </div>

            <div class="p-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
                <button onclick="editSiswa(${JSON.stringify(s).replace(/"/g, '&quot;')})" class="px-5 py-2.5 bg-amber-100 text-amber-700 rounded-xl font-bold text-sm hover:bg-amber-200 transition flex items-center gap-2">
                    <i class="fas fa-edit"></i> Edit Data
                </button>
                <button onclick="closeModal()" class="px-5 py-2.5 bg-gray-200 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-300 transition">
                    Tutup
                </button>
            </div>
        </div>`;
    }

// UPDATE: Modal Guru kini mendukung MULTI-KELAS (checkbox)
    function createGuruModal(guru = null) {
        const isEdit = guru !== null;
        const inputClass = "w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-purple-500 focus:border-purple-500 block p-3 transition-all mb-4";
        
        // Kelas yang sudah dipilih guru (bisa lebih dari satu, dipisah koma)
        const selectedKelas = guru && guru.kelas
            ? String(guru.kelas).split(',').map(k => k.trim()).filter(Boolean)
            : [];

        // Guru dianggap "Wali Kelas Semua Kelas" jika field kelas-nya kosong
        // (kelas kosong = akses semua, sesuai logika backend yang sudah ada)
        const isSemuaKelas = isEdit && selectedKelas.length === 0;

        // Generate checkbox list kelas
        let kelasCheckboxes = '';
        if (existingClasses && existingClasses.length > 0) {
            kelasCheckboxes = existingClasses.map(k => {
                const checked = selectedKelas.includes(k) ? 'checked' : '';
                return `
                <label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-purple-50 cursor-pointer transition">
                    <input type="checkbox" name="kelas_cb" value="${k}" ${checked}
                        class="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer">
                    <span class="text-sm text-gray-700 font-medium">${k}</span>
                </label>`;
            }).join('');
        } else {
            kelasCheckboxes = '<p class="text-xs text-gray-400 px-3 py-2">Belum ada data kelas</p>';
        }

        return `
        <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative overflow-hidden">
            <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
            <div class="text-center mb-6">
                <div class="w-14 h-14 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl shadow-sm"><i class="fas fa-chalkboard-teacher"></i></div>
                <h3 class="font-bold text-xl text-gray-800">${isEdit ? 'Edit Akun Guru' : 'Tambah Guru'}</h3>
            </div>
            
            <form onsubmit="saveGuru(event, ${isEdit})">
                <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Username</label>
                <input name="username" value="${guru?.username || ''}" placeholder="Username" required class="${inputClass}">
                
                <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Password</label>
                <input name="password" value="${guru?.password || ''}" placeholder="Password" required class="${inputClass}">
                
                <label class="block mb-1 text-xs font-bold text-gray-500 uppercase">Wali Kelas Untuk</label>

                <label class="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg bg-purple-50 border border-purple-200 cursor-pointer transition">
                    <input type="checkbox" id="cbSemuaKelasGuru" ${isSemuaKelas ? 'checked' : ''}
                        onchange="toggleSemuaKelasGuru(this)"
                        class="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer">
                    <span class="text-sm text-purple-700 font-bold">📋 Wali Kelas Semua Kelas</span>
                </label>

                <div id="kelasCheckboxWrap" class="border border-gray-200 rounded-lg overflow-y-auto mb-1 transition-opacity ${isSemuaKelas ? 'opacity-40 pointer-events-none' : ''}" style="max-height:160px;">
                    ${kelasCheckboxes}
                </div>
                <p class="text-[10px] text-gray-400 mb-4">Centang "Semua Kelas" untuk akses tanpa batas, atau pilih satu/lebih kelas tertentu sebagai wali kelas.</p>
                
                ${isEdit ? `<input type="hidden" name="oldUsername" value="${guru.username}">` : ''}

                <div class="flex gap-3 mt-2">
                    <button type="button" onclick="closeModal()" class="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200 transition">Batal</button>
                    <button type="submit" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-bold shadow-lg transition transform active:scale-95">Simpan</button>
                </div>
            </form>
        </div>`;
    }

    // Aktif/nonaktifkan daftar checkbox kelas saat "Wali Kelas Semua Kelas" dicentang
    function toggleSemuaKelasGuru(cb) {
        const wrap = document.getElementById('kelasCheckboxWrap');
        if (!wrap) return;
        if (cb.checked) {
            wrap.classList.add('opacity-40', 'pointer-events-none');
            wrap.querySelectorAll('input[name="kelas_cb"]').forEach(el => { el.checked = false; });
        } else {
            wrap.classList.remove('opacity-40', 'pointer-events-none');
        }
    }

    // --- FORM ACTIONS (SIMPAN & UPDATE) ---
    // FUNCTION UPDATE: Simpan Guru dengan Loading Button
function saveGuru(e, isEdit) {
    e.preventDefault();
    
    // 1. Ambil elemen tombol untuk efek loading
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML; 

    // 2. Ubah tampilan tombol menjadi Loading
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Menyimpan...';
    btn.classList.add('opacity-75', 'cursor-not-allowed');

    // 3. Ambil Data Form
    const fd = new FormData(form);
    const username = "'" + fd.get('username'); 
    const password = "'" + fd.get('password');
    // Kumpulkan semua checkbox kelas yang dicentang, gabung dengan koma
    const isSemuaKelasChecked = document.getElementById('cbSemuaKelasGuru')?.checked;
    const checkedKelas = Array.from(form.querySelectorAll('input[name="kelas_cb"]:checked'))
        .map(cb => cb.value);
    // Jika "Wali Kelas Semua Kelas" dicentang, kirim kelas kosong (= akses semua)
    const kelas = isSemuaKelasChecked ? '' : checkedKelas.join(',');

    // --- KEAMANAN: AMBIL TOKEN USER ---
    const token = currentUser ? currentUser.token : null;
    // ----------------------------------

    // 4. Callback saat selesai
    const onComplete = (r) => {
        // Kembalikan tombol ke kondisi semula
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');

        if (r && r.success) {
            closeModal();
            // Reset cache & reload tabel
            tableState.guru.fullData = [];
            loadDataGuru();
            showAlert('success', isEdit ? 'Data guru berhasil diperbarui' : 'Akun Guru berhasil dibuat');
        } else {
            showAlert('error', r ? r.message : 'Terjadi kesalahan tidak diketahui');
        }
    };

    // Callback jika koneksi gagal
    const onFailure = (error) => {
        btn.disabled = false;
        btn.innerHTML = originalText;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
        showAlert('error', 'Gagal koneksi server: ' + error);
    };

    // 5. Eksekusi ke Server (Kirim Token sebagai parameter pertama)
    if (isEdit) {
        const oldUsername = fd.get('oldUsername');
        gas.run
            .withSuccessHandler(onComplete)
            .withFailureHandler(onFailure)
            .updateGuru(token, oldUsername, username, password, kelas); // <-- Token dikirim
    } else {
        gas.run
            .withSuccessHandler(onComplete)
            .withFailureHandler(onFailure)
            .addGuru(token, username, password, kelas); // <-- Token dikirim
    }
}
    
function deleteSiswaConfirm(nis, nama) {
        // Panggil SweetAlert untuk konfirmasi
        Swal.fire({
            title: 'Apakah Anda yakin?',
            text: `Data siswa "${nama}" akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan!`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EF4444', // Warna Merah
            cancelButtonColor: '#6B7280',  // Warna Abu
            confirmButtonText: 'Ya, Hapus!',
            cancelButtonText: 'Batal',
            reverseButtons: true
        }).then((result) => {
            // Jika tombol "Ya, Hapus!" diklik
            if (result.isConfirmed) {
                showLoading(); // Tampilkan loading overlay

                // === KEAMANAN: AMBIL TOKEN ===
                const token = currentUser.token; 

                // Panggil Backend dengan Token
                gas.run.withSuccessHandler(r => {
                    hideLoading();
                    
                    if (r.success) {
                        // Refresh Tabel Siswa
                        tableState.siswa.fullData = []; // Clear cache
                        loadDataSiswa(); // Reload data
                        
                        // Pesan Sukses
                        Swal.fire(
                            'Terhapus!',
                            'Data siswa berhasil dihapus.',
                            'success'
                        );
                    } else {
                        // Pesan Gagal (Misal: Token expired atau bukan admin)
                        Swal.fire(
                            'Gagal!',
                            r.message,
                            'error'
                        );
                    }
                })
                .withFailureHandler(err => {
                    hideLoading();
                    Swal.fire('Error', 'Terjadi kesalahan server: ' + err, 'error');
                })
                .deleteSiswa(token, nis); // <-- PARAMETER TOKEN DITAMBAHKAN DI SINI
            }
        });
    }
// ==========================================================================
    // FITUR IMPORT EXCEL SISWA
    // ==========================================================================
    
    function triggerImportSiswa() {
        document.getElementById('fileInputSiswa').click();
    }

function handleFileImportSiswa(input) {
        const file = input.files[0];
        if (!file) return;

        showLoading(); // Tampilkan loading overlay

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Ambil sheet pertama
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Konversi ke JSON
            // defval: "" memastikan sel kosong tetap terbaca sebagai string kosong
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                hideLoading();
                showAlert('error', 'File Excel kosong atau format salah.');
                input.value = ''; // Reset input
                return;
            }

            // === VALIDASI HEADER (DIPERBAIKI) ===
            const firstRow = jsonData[0];

            // Cek apakah ada kolom 'Nama' ATAU 'Nama Lengkap'
            const hasNama = firstRow.hasOwnProperty('Nama') || firstRow.hasOwnProperty('Nama Lengkap');
            // Cek apakah ada kolom 'NIS'
            const hasNIS = firstRow.hasOwnProperty('NIS');

            if (!hasNama || !hasNIS) {
                hideLoading();
                showAlert('error', 'Format Excel salah! Pastikan ada kolom header: Nama (atau Nama Lengkap) dan NIS.');
                input.value = '';
                return;
            }
            // ====================================

            // Kirim ke Backend
            processImportSiswa(jsonData, input);
        };

        reader.onerror = function() {
            hideLoading();
            showAlert('error', 'Gagal membaca file.');
            input.value = '';
        };

        reader.readAsArrayBuffer(file);
    }

function processImportSiswa(data, inputElement) {
        // Mapping data Excel ke Format Database
        // Menggunakan operator || (OR) agar bisa membaca variasi nama kolom
        
        const formattedData = data.map(row => {
            // Helper untuk membersihkan data string
            const clean = (val) => (val ? String(val).trim() : '');

            return {
                // Prioritas 1: Nama Lengkap, Prioritas 2: Nama
                nama: clean(row['Nama Lengkap'] || row['Nama']),
                
                // NIS (Hapus kutip jika ada)
                nis: clean(row['NIS']).replace(/'/g, ""), 
                
                // Prioritas 1: Jenis Kelamin, Prioritas 2: JK
                jenisKelamin: clean(row['Jenis Kelamin'] || row['JK']), 
                
                // Prioritas 1: Tanggal Lahir, Prioritas 2: Tgl Lahir
                // Pastikan format di Excel Text (YYYY-MM-DD) atau Date
                tanggalLahir: clean(row['Tanggal Lahir'] || row['Tgl Lahir']), 
                
                agama: clean(row['Agama']),
                
                namaAyah: clean(row['Nama Ayah']),
                
                namaIbu: clean(row['Nama Ibu']),
                
                // Prioritas 1: No Handphone, Prioritas 2: HP, Prioritas 3: No HP
                noHp: clean(row['No Handphone'] || row['HP'] || row['No HP']),
                
                kelas: clean(row['Kelas']),
                
                alamat: clean(row['Alamat']),

                noAbsen: clean(row['No. Absen'] || row['No Absen'] || row['Absen']),

                // Prioritas 1: No. Kartu, Prioritas 2: No Kartu
                noKartu: clean(row['No. Kartu'] || row['No Kartu']).replace(/'/g, ""),

                foto: clean(row['Foto'] || row['Link Foto'] || row['Foto Siswa'])
            };
        });

        // Debugging: Cek data pertama di console browser jika ingin memastikan
        console.log("Data Siap Import:", formattedData[0]);

        gas.run
            .withSuccessHandler(res => {
                hideLoading();
                inputElement.value = ''; 
                
                if (res.success) {
                    tableState.siswa.fullData = [];
                    loadDataSiswa(); 
                    let msg = `Berhasil: ${res.added}, Gagal/Duplikat: ${res.skipped}`;
                    showAlert('success', 'Import Selesai! ' + msg);
                } else {
                    showAlert('error', res.message);
                }
            })
            .withFailureHandler(err => {
                hideLoading();
                inputElement.value = '';
                showAlert('error', 'Error Server: ' + err);
            })
            .importSiswaBulk(formattedData);
    }


// ==========================================================================
    // FITUR IMPORT EXCEL GURU
    // ==========================================================================
    
    function triggerImportGuru() {
        document.getElementById('fileInputGuru').click();
    }

    function handleFileImportGuru(input) {
        const file = input.files[0];
        if (!file) return;

        showLoading(); 

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                hideLoading();
                showAlert('error', 'File Excel kosong atau format salah.');
                input.value = ''; 
                return;
            }

            // Validasi Header
            const firstRow = jsonData[0];
            // Kita cek header 'Username' dan 'Password'
            const hasUser = firstRow.hasOwnProperty('Username');
            const hasPass = firstRow.hasOwnProperty('Password');

            if (!hasUser || !hasPass) {
                hideLoading();
                showAlert('error', 'Format Excel salah! Pastikan ada kolom header: Username dan Password.');
                input.value = '';
                return;
            }

            processImportGuru(jsonData, input);
        };

        reader.onerror = function() {
            hideLoading();
            showAlert('error', 'Gagal membaca file.');
            input.value = '';
        };

        reader.readAsArrayBuffer(file);
    }

    function processImportGuru(data, inputElement) {
        // Mapping data Excel ke Format Database
        const formattedData = data.map(row => {
            const clean = (val) => (val ? String(val).trim() : '');
            return {
                username: clean(row['Username']),
                password: clean(row['Password']),
                // Opsional: Jika guru tersebut adalah Wali Kelas
                kelas: clean(row['Kelas'] || row['Wali Kelas']) 
            };
        });

        gas.run
            .withSuccessHandler(res => {
                hideLoading();
                inputElement.value = ''; 
                
                if (res.success) {
                    tableState.guru.fullData = []; // Clear cache
                    loadDataGuru(); // Reload tabel
                    let msg = `Berhasil: ${res.added}, Gagal/Duplikat: ${res.skipped}`;
                    showAlert('success', 'Import Guru Selesai! ' + msg);
                } else {
                    showAlert('error', res.message);
                }
            })
            .withFailureHandler(err => {
                hideLoading();
                inputElement.value = '';
                showAlert('error', 'Error Server: ' + err);
            })
            .importGuruBulk(formattedData);
    }

// ==========================================
// LOGIKA REKAP BULANAN
// ==========================================

function loadMenuRekapBulanan() {
    stopAndBack(false);
    setActiveMenu('Rekap Bulanan');
    showView('view-rekap-bulanan');

    // Setup Dropdown Tahun (5 tahun ke belakang)
    const selectTahun = document.getElementById('rekapTahun');
    const currentYear = new Date().getFullYear();
    selectTahun.innerHTML = '';
    for(let i = 0; i < 5; i++) {
        let yr = currentYear - i;
        let opt = document.createElement('option');
        opt.value = yr;
        opt.text = yr;
        selectTahun.appendChild(opt);
    }

    // Setup Dropdown Bulan (Default bulan ini)
    const selectBulan = document.getElementById('rekapBulan');
    selectBulan.value = new Date().getMonth();

    // Setup Dropdown Kelas
    const selectKelas = document.getElementById('rekapKelas');
    const fillDropdown = () => {
        // Jika role guru, hanya tampilkan kelas yang diajarkan
        if (currentUser && currentUser.role === 'guru' && currentUser.kelas) {
            const guruKelas = String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean);
            selectKelas.innerHTML = '';
            guruKelas.forEach(kelas => {
                const option = document.createElement('option');
                option.value = kelas;
                option.textContent = kelas;
                selectKelas.appendChild(option);
            });
            // Auto-select kelas pertama jika hanya ada 1 kelas
            if (guruKelas.length === 1) {
                selectKelas.value = guruKelas[0];
            }
        } else {
            selectKelas.innerHTML = '<option value="">Semua Kelas</option>';
            if (existingClasses && existingClasses.length > 0) {
                existingClasses.forEach(kelas => {
                    const option = document.createElement('option');
                    option.value = kelas;
                    option.textContent = kelas;
                    selectKelas.appendChild(option);
                });
            }
        }
    };

    // Guru: langsung isi dropdown dari data currentUser (tidak perlu fetch)
    if (currentUser && currentUser.role === 'guru' && currentUser.kelas) {
        fillDropdown();
    } else if (existingClasses && existingClasses.length > 0) {
        fillDropdown();
    } else {
        gas.run.withSuccessHandler(result => {
            if (result.success) {
                existingClasses = result.data;
                fillDropdown();
            }
        }).getKelasList();
    }
}

function loadDataRekapBulanan() {
    const bulan = document.getElementById('rekapBulan').value;
    const tahun = document.getElementById('rekapTahun').value;
    const kelas = document.getElementById('rekapKelas').value;

    const tbody = document.getElementById('tbody-rekap-bulanan');
    const thead = document.getElementById('thead-rekap-bulanan');
    
    tbody.innerHTML = '<tr><td colspan="10" class="p-8 text-center"><i class="fas fa-circle-notch fa-spin mr-2"></i>Mengambil data...</td></tr>';

    gas.run.withSuccessHandler(res => {
        if(!res.success) {
            tbody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-red-500">${res.message}</td></tr>`;
            return;
        }
        
        const data = res.data; // { daysInMonth, students: [...] }
        
        // 1. RENDER HEADER
        let headerHTML = '<th class="p-3 w-10 text-center bg-gray-100 sticky left-0 z-20">No</th>';
        headerHTML += '<th class="p-3 w-40 bg-gray-100 sticky left-10 z-20">Nama Siswa</th>';
        
        // Loop tanggal 1 s.d akhir bulan
        for(let d=1; d<=data.daysInMonth; d++) {
            headerHTML += `<th class="p-1 text-center w-8 text-[10px] border-l border-gray-200">${d}</th>`;
        }
        // Header Statistik
        headerHTML += '<th class="p-2 w-8 text-center bg-green-50 text-green-700 border-l">H</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-yellow-50 text-yellow-700">S</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-blue-50 text-blue-700">I</th>';
        headerHTML += '<th class="p-2 w-8 text-center bg-red-50 text-red-700">A</th>';
        headerHTML += '<th class="p-2 w-12 text-center bg-gray-100">%</th>';
        
        thead.innerHTML = headerHTML;

        // 2. RENDER BODY
        if(data.students.length === 0) {
            tbody.innerHTML = '<tr><td colspan="40" class="p-8 text-center text-gray-400">Tidak ada data siswa.</td></tr>';
            return;
        }

        let rowsHTML = '';
        data.students.forEach((siswa, idx) => {
            let row = `<tr class="hover:bg-gray-50 border-b border-gray-100 group">`;
            row += `<td class="p-3 text-center text-gray-500 sticky left-0 bg-white group-hover:bg-gray-50 z-10">${idx+1}</td>`;
            row += `<td class="p-3 font-bold text-gray-700 text-xs sticky left-10 bg-white group-hover:bg-gray-50 z-10 truncate max-w-[150px]" title="${siswa.nama}">${siswa.nama}</td>`;
            
            // Loop Kode Harian
            siswa.dailyCodes.forEach(day => {
                let colorClass = '';
                let bgClass = '';
                if(day.isHoliday) bgClass = 'bg-red-50'; // Kolom Libur
                
                if(day.code === 'H') colorClass = 'text-green-600 font-bold';
                else if(day.code === 'S') colorClass = 'text-yellow-600 font-bold bg-yellow-50';
                else if(day.code === 'I') colorClass = 'text-blue-600 font-bold bg-blue-50';
                else if(day.code === 'A') colorClass = 'text-red-600 font-bold bg-red-50';
                else if(day.code === 'L') { colorClass = 'text-red-300'; bgClass = 'bg-red-50'; }
                
                row += `<td class="p-1 text-center text-[10px] border-l border-gray-100 ${colorClass} ${bgClass}">${day.code}</td>`;
            });

            // Statistik
            row += `<td class="p-2 text-center text-xs font-bold text-green-700 bg-green-50/30 border-l">${siswa.stats.h}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-yellow-700 bg-yellow-50/30">${siswa.stats.s}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-blue-700 bg-blue-50/30">${siswa.stats.i}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-red-700 bg-red-50/30">${siswa.stats.a}</td>`;
            row += `<td class="p-2 text-center text-xs font-bold text-gray-700 bg-gray-50">${siswa.stats.percent}%</td>`;
            
            row += `</tr>`;
            rowsHTML += row;
        });
        
        tbody.innerHTML = rowsHTML;

    }).getMonthlyReportData(parseInt(bulan), parseInt(tahun), kelas);
}

function renderRekapTable(result) {
    if (!result.success) {
        document.getElementById('tbody-rekap-bulanan').innerHTML = `<tr><td colspan="100%" class="p-8 text-center text-red-500">${result.message}</td></tr>`;
        return;
    }

    const { daysInMonth, students } = result.data;
    const thead = document.getElementById('thead-rekap-bulanan');
    const tbody = document.getElementById('tbody-rekap-bulanan');

    // --- 1. GENERATE HEADER ---
    let headerHtml = `
        <th class="p-3 w-10 sticky left-0 bg-gray-100 z-20 border-r border-gray-200">No</th>
        <th class="p-3 w-64 sticky left-10 bg-gray-100 z-20 border-r border-gray-200 shadow-sm">Nama Siswa</th>
    `;
    
    // Ambil info libur dari siswa pertama (karena pola libur sama untuk semua)
    // Kita asumsikan siswa pertama ada datanya.
    const sampleDaily = students.length > 0 ? students[0].dailyCodes : [];

    // Loop Header Tanggal
    for (let d = 1; d <= daysInMonth; d++) {
        // Cek apakah hari ini libur berdasarkan data sample
        // index array mulai dari 0, tanggal mulai dari 1. Jadi index = d-1
        const dayInfo = sampleDaily[d-1]; 
        const isHoliday = dayInfo ? dayInfo.isHoliday : false;
        
        // Warna Header: Jika libur, background merah muda, teks merah
        const headerClass = isHoliday 
            ? "bg-red-50 text-red-600 border-red-100 font-bold" 
            : "bg-gray-50 text-gray-600 border-gray-200";

        headerHtml += `<th class="p-1 w-8 text-center border-l ${headerClass} text-[10px]">${d}</th>`;
    }
    
    // Header Statistik
    headerHtml += `
        <th class="p-2 w-10 text-center bg-green-50 text-green-700 border-l-2 border-gray-200">H</th>
        <th class="p-2 w-10 text-center bg-yellow-50 text-yellow-700">S</th>
        <th class="p-2 w-10 text-center bg-blue-50 text-blue-700">I</th>
        <th class="p-2 w-10 text-center bg-red-50 text-red-700">A</th>
        <th class="p-2 w-16 text-center bg-indigo-50 text-indigo-700 font-bold">%</th>
    `;
    thead.innerHTML = headerHtml;

    // --- 2. GENERATE BODY ---
    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="100%" class="p-8 text-center text-gray-400">Tidak ada data siswa.</td></tr>';
        return;
    }

    let bodyHtml = '';
    students.forEach((siswa, index) => {
        let dailyCells = '';
        
        siswa.dailyCodes.forEach(day => {
            let bgClass = '';
            let textClass = 'text-gray-400';
            let content = day.code;

            // LOGIKA WARNA BARU
            if (day.isHoliday) {
                // HARI LIBUR: Full Block Warna Merah Muda (Arsir)
                bgClass = 'bg-red-50 pattern-grid-lg'; // pattern opsional
                textClass = 'text-red-300 select-none'; 
                content = ''; // Kosongkan visual atau isi 'L' samar
            } else {
                // HARI EFEKTIF
                if (day.code === 'H') { 
                    bgClass = 'bg-green-100'; 
                    textClass = 'text-green-700 font-bold'; 
                }
                else if (day.code === 'S') { 
                    bgClass = 'bg-yellow-100'; 
                    textClass = 'text-yellow-700 font-bold'; 
                }
                else if (day.code === 'I') { 
                    bgClass = 'bg-blue-100'; 
                    textClass = 'text-blue-700 font-bold'; 
                }
                else if (day.code === 'A') { 
                    // ALPHA: Merah Lebih Gelap/Kontras
                    bgClass = 'bg-red-100'; 
                    textClass = 'text-red-600 font-bold'; 
                }
                else { 
                    content = '-'; 
                }
            }
            
            // Border diperhalus
            const borderClass = day.isHoliday ? 'border-red-50' : 'border-gray-100';
            dailyCells += `<td class="p-1 text-center border ${borderClass} ${bgClass} ${textClass} text-[10px]">${content}</td>`;
        });

        const stats = siswa.stats;
        const percentColor = stats.percent < 70 ? 'text-red-600' : (stats.percent < 90 ? 'text-yellow-600' : 'text-green-600');

        bodyHtml += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-50">
                <td class="p-2 text-center border-r border-gray-200 sticky left-0 bg-white z-10 font-medium text-gray-500">${index + 1}</td>
                <td class="p-2 border-r border-gray-200 sticky left-10 bg-white z-10 shadow-sm whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]" title="${siswa.nama}">
                    <div class="font-bold text-gray-700 text-xs">${siswa.nama}</div>
                    <div class="text-[10px] text-gray-400">${siswa.nis}</div>
                </td>
                ${dailyCells}
                <td class="p-1 text-center font-bold text-green-600 bg-green-50/30 border-l-2 border-gray-100">${stats.h}</td>
                <td class="p-1 text-center font-bold text-yellow-600 bg-yellow-50/30">${stats.s}</td>
                <td class="p-1 text-center font-bold text-blue-600 bg-blue-50/30">${stats.i}</td>
                <td class="p-1 text-center font-bold text-red-600 bg-red-50/30">${stats.a}</td>
                <td class="p-1 text-center font-bold ${percentColor} bg-indigo-50 border-l border-gray-200">${stats.percent}%</td>
            </tr>
        `;
    });

    tbody.innerHTML = bodyHtml;
}

function exportRekapBulananExcel() {
    const btn = document.getElementById('btnExportRekap');
    const originalContent = btn.innerHTML;
    const bulan = document.getElementById('rekapBulan').value;
    const tahun = document.getElementById('rekapTahun').value;
    
    // AMBIL FILTER KELAS
    let kelas = document.getElementById('rekapKelas').value;
    if (currentUser.role === 'guru' && currentUser.kelas) {
        kelas = currentUser.kelas;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Loading...';

    const filters = {
        bulan: parseInt(bulan),
        tahun: parseInt(tahun),
        kelas: kelas // Kirim kelas yang dipilih
    };

    gas.run.withSuccessHandler(result => {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        if (result.success) {
            window.open(result.url, '_blank');
        } else {
            showAlert('error', result.message);
        }
    })
    .withFailureHandler(err => {
        btn.disabled = false;
        btn.innerHTML = originalContent;
        showAlert('error', 'Gagal: ' + err);
    })
    .generateExcel('laporan_bulanan', filters);
}

// ==========================================
// LOGIKA KENAIKAN KELAS & ARSIP
// ==========================================

function loadKenaikanKelas() {
    stopAndBack(false);
    setActiveMenu('Kenaikan Kelas');
    showView('view-kenaikan-kelas');
    
    // Reset Form
    document.getElementById('container-promo-siswa').classList.add('hidden');
    document.getElementById('promo-placeholder').classList.remove('hidden');
    
    // Init Dropdown Kelas
    const selAsal = document.getElementById('promoKelasAsal');
    const selTujuan = document.getElementById('promoKelasTujuan');
    
    // Reset options (Keep default and LULUS)
    selAsal.innerHTML = '<option value="">-- Pilih Kelas --</option>';
    selTujuan.innerHTML = '<option value="">-- Pilih Tujuan --</option><option value="LULUS" class="font-bold text-green-600">🎓 LULUS (Alumni)</option>';

    if (existingClasses && existingClasses.length > 0) {
        existingClasses.sort();
        existingClasses.forEach(c => {
            // Isi Kelas Asal
            const opt1 = document.createElement('option');
            opt1.value = c;
            opt1.text = c;
            selAsal.add(opt1);

            // Isi Kelas Tujuan
            const opt2 = document.createElement('option');
            opt2.value = c;
            opt2.text = c;
            selTujuan.add(opt2);
        });
    } else {
        // Fetch jika belum ada cache
        gas.run.withSuccessHandler(classes => {
            existingClasses = classes;

            // PERBAIKAN: Jangan panggil loadKenaikanKelas() lagi karena bisa
            // memaksa kembali ke menu ini jika user sudah pindah ke menu lain.
            // Cek dulu apakah view kenaikan kelas masih aktif sebelum mengisi dropdown.
            const viewEl = document.getElementById('view-kenaikan-kelas');
            if (!viewEl || !viewEl.classList.contains('active')) return;

            // Isi dropdown langsung tanpa reload halaman
            if (classes && classes.length > 0) {
                classes.sort();
                classes.forEach(c => {
                    const opt1 = document.createElement('option');
                    opt1.value = c; opt1.text = c;
                    selAsal.add(opt1);

                    const opt2 = document.createElement('option');
                    opt2.value = c; opt2.text = c;
                    selTujuan.add(opt2);
                });
            }
        }).getDaftarKelas();
    }
}

function loadSiswaUntukPromosi() {
    const asal = document.getElementById('promoKelasAsal').value;
    const tujuan = document.getElementById('promoKelasTujuan').value;

    if (!asal || !tujuan) {
        showAlert('error', 'Harap pilih Kelas Asal dan Kelas Tujuan.');
        return;
    }

    if (asal === tujuan) {
        showAlert('error', 'Kelas Asal dan Tujuan tidak boleh sama.');
        return;
    }

    showLoading(); // Overlay loading (buat function ini jika belum ada) atau manual:
    document.getElementById('tbody-promo-siswa').innerHTML = '<tr><td colspan="4" class="p-4 text-center"><i class="fas fa-circle-notch fa-spin"></i> Mengambil data siswa...</td></tr>';
    document.getElementById('container-promo-siswa').classList.remove('hidden');
    document.getElementById('promo-placeholder').classList.add('hidden');

    gas.run.withSuccessHandler(siswaList => {
        hideLoading();
        renderTablePromosi(siswaList, tujuan);
    }).getSiswaByKelas(asal);
}

function renderTablePromosi(siswaList, namaKelasTujuan) {
    const tbody = document.getElementById('tbody-promo-siswa');
    tbody.innerHTML = '';

    if (siswaList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-500">Tidak ada siswa di kelas ini.</td></tr>';
        return;
    }

    siswaList.forEach((s, i) => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition border-b border-gray-50";
        
        // Label tombol switch
        const labelNaik = namaKelasTujuan === 'LULUS' ? 'Lulus' : 'Naik Kelas';
        const classNaik = namaKelasTujuan === 'LULUS' ? 'text-green-600' : 'text-indigo-600';
        
        tr.innerHTML = `
            <td class="p-3 text-center text-gray-500">${i + 1}</td>
            <td class="p-3 font-medium text-gray-800">${s.nama}</td>
            <td class="p-3 text-gray-500 text-xs">${s.nis}</td>
            <td class="p-3 text-center">
                <div class="flex items-center justify-center gap-4 promo-row" data-nis="${s.nis}" data-nama="${s.nama}">
                    
                    <label class="cursor-pointer flex items-center gap-2 p-2 rounded-lg border border-transparent hover:bg-green-50 transition">
                        <input type="radio" name="status_${s.nis}" value="NAIK" checked class="w-4 h-4 text-green-600 focus:ring-green-500">
                        <span class="text-xs font-bold ${classNaik}">${labelNaik}</span>
                 
   </label>

                    <label class="cursor-pointer flex items-center gap-2 p-2 rounded-lg border border-transparent hover:bg-red-50 transition">
                        <input type="radio" name="status_${s.nis}" value="TINGGAL" class="w-4 h-4 text-red-600 focus:ring-red-500">
                        <span class="text-xs font-bold text-red-600">Tinggal Kelas</span>
                    </label>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function executePromotion() {
    const asal = document.getElementById('promoKelasAsal').value;
    const tujuan = document.getElementById('promoKelasTujuan').value;
    
    // Kumpulkan Data
    const rows = document.querySelectorAll('.promo-row');
    const promoData = [];
    let countNaik = 0;
    let countTinggal = 0;

    rows.forEach(row => {
        const nis = row.getAttribute('data-nis');
        const nama = row.getAttribute('data-nama');
        // Cari radio button yang checked dalam baris ini
        const status = document.querySelector(`input[name="status_${nis}"]:checked`).value;
        
        promoData.push({
            nis: nis,
            nama: nama,
            status: status // 'NAIK' atau 'TINGGAL'
        });

        if (status === 'NAIK') countNaik++;
        else countTinggal++;
    });

    if (promoData.length === 0) return;

    Swal.fire({
        title: 'Konfirmasi Kenaikan',
        html: `
            Anda akan memproses kelas <b>${asal}</b> ke <b>${tujuan}</b>.<br><br>
            <ul class="text-left text-sm bg-gray-50 p-3 rounded">
                <li>✅ <b>${countNaik}</b> siswa Naik/Lulus</li>
                <li>❌ <b>${countTinggal}</b> siswa Tinggal Kelas</li>
            </ul>
            <br>Lanjutkan?
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        confirmButtonText: 'Ya, Proses!'
    }).then((result) => {
        if (result.isConfirmed) {
            const btn = document.getElementById('btn-eksekusi-promo');
            const originalTxt = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sedang memproses database...';

            gas.run.withSuccessHandler(res => {
                btn.disabled = false;
                btn.innerHTML = originalTxt;
                
                if (res.success) {
                    Swal.fire('Berhasil!', `Data berhasil diperbarui.`, 'success');
                    // Reset View
                    loadKenaikanKelas();
                    // Refresh Cache Data Siswa
                    loadDataSiswa();
                } else {
                    Swal.fire('Gagal', res.message, 'error');
                }
            }).processIndividualPromotion(asal, tujuan, promoData);
        }
    });
}
function showModalArsip() {
    Swal.fire({
        title: 'Tutup Tahun Ajaran (Arsip)',
        html: `
            <p class="text-xs text-gray-600 mb-3">Backup data presensi ke file baru & reset database presensi utama.</p>
            <input type="text" id="swal-input-arsip" class="swal2-input" placeholder="Nama File Arsip (misal: Presensi 2024-2025)">
        `,
        showCancelButton: true,
        confirmButtonText: 'Arsipkan & Reset',
        confirmButtonColor: '#d33',
        preConfirm: () => {
            const nama = Swal.getPopup().querySelector('#swal-input-arsip').value;
            if (!nama) Swal.showValidationMessage('Nama arsip wajib diisi');
            return nama;
        }
    }).then((result) => {
        if (result.isConfirmed) {
            // Panggil fungsi backend archiveAndResetYear (sama seperti sebelumnya)
            showLoading();
            gas.run.withSuccessHandler(res => {
                hideLoading();
                if(res.success) Swal.fire('Sukses', 'Data berhasil diarsipkan', 'success');
                else Swal.fire('Gagal', res.message, 'error');
            }).archiveAndResetYear(result.value);
        }
    });
}

function showLoading() {
    Swal.fire({
        title: 'Loading...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading() }
    });
}
function hideLoading() {
    Swal.close();
}
function renderMappingTable(classes) {
    const tbody = document.getElementById('tbody-mapping-kelas');
    tbody.innerHTML = '';

    // Sort kelas agar rapi (1A, 1B, 2A...)
    classes.sort();

    classes.forEach(kelasAsal => {
        // Buat opsi dropdown untuk target kelas
        let options = `<option value="">-- Pilih --</option>`;
        options += `<option value="LULUS" class="font-bold text-red-600">🎓 LULUS (Jadi Alumni)</option>`;
        
        classes.forEach(kelasTujuan => {
            // Logika auto-select sederhana (Misal 1-A -> 2-A)
            // Ini opsional, user bisa ganti manual
            options += `<option value="${kelasTujuan}">${kelasTujuan}</option>`;
        });

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition";
        tr.innerHTML = `
            <td class="p-3 font-bold text-gray-700 border-b border-gray-100">
                <input type="hidden" class="input-kelas-asal" value="${kelasAsal}">
                ${kelasAsal}
            </td>
            <td class="p-3 text-center text-gray-400 border-b border-gray-100">
                <i class="fas fa-arrow-right"></i>
            </td>
            <td class="p-3 border-b border-gray-100">
                <select class="input-kelas-tujuan w-full p-1 border border-gray-300 rounded text-sm focus:ring-indigo-500">
                    ${options}
                </select>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function processKenaikanKelas() {
    // 1. Kumpulkan Data Mapping
    const mapping = [];
    const rows = document.querySelectorAll('#tbody-mapping-kelas tr');
    let isValid = true;

    rows.forEach(row => {
        const asal = row.querySelector('.input-kelas-asal').value;
        const tujuan = row.querySelector('.input-kelas-tujuan').value;
        
        if (tujuan) {
            mapping.push({ asal: asal, tujuan: tujuan });
        }
    });

    if (mapping.length === 0) {
        showAlert('error', 'Belum ada kenaikan kelas yang dipilih.');
        return;
    }

    // 2. Konfirmasi SweetAlert
    Swal.fire({
        title: 'Konfirmasi Kenaikan?',
        text: `Anda akan memproses ${mapping.length} aturan kenaikan kelas. Data siswa akan berubah permanen!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#4F46E5',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Ya, Proses Sekarang!'
    }).then((result) => {
        if (result.isConfirmed) {
            // UI Loading
            const btn = document.getElementById('btn-proses-naik');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Memproses...';

            gas.run.withSuccessHandler(res => {
                btn.disabled = false;
                btn.innerHTML = originalText;
                
                if (res.success) {
                    Swal.fire('Berhasil!', `Data berhasil diperbarui. ${res.movedCount} siswa dipindahkan/lulus.`, 'success');
                    // Refresh data
                    loadDataSiswa(); // Refresh cache siswa
                    loadKenaikanKelas(); // Reset form
                } else {
                    Swal.fire('Gagal', res.message, 'error');
                }
            }).processGradePromotion(mapping);
        }
    });
}

function processTutupTahun() {
    const namaArsip = document.getElementById('namaArsip').value.trim();
    
    if (!namaArsip) {
        showAlert('error', 'Harap isi Label Arsip terlebih dahulu (Misal: Arsip 2024-2025)');
        return;
    }

    Swal.fire({
        title: 'TUTUP TAHUN AJARAN?',
        html: `Anda akan mengarsipkan data ke file <b>"${namaArsip}"</b> dan <span style="color:red; font-weight:bold;">MENGHAPUS SEMUA DATA PRESENSI</span> di aplikasi ini.<br><br>Tindakan ini tidak dapat dibatalkan!`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#059669', // Emerald
        cancelButtonColor: '#d33',
        confirmButtonText: 'Ya, Saya Paham & Lanjutkan'
    }).then((result) => {
        if (result.isConfirmed) {
            const btn = document.getElementById('btn-proses-arsip');
            const originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-cog fa-spin"></i> Mengarsipkan... (Bisa memakan waktu)';

            gas.run.withSuccessHandler(res => {
                btn.disabled = false;
                btn.innerHTML = originalText;
                
                if (res.success) {
                    Swal.fire('Selesai!', `Data presensi berhasil diarsipkan ke spreadsheet baru.<br><a href="${res.url}" target="_blank" class="text-blue-600 underline">Buka Arsip</a>`, 'success');
                    document.getElementById('namaArsip').value = '';
                } else {
                    Swal.fire('Gagal', res.message, 'error');
                }
            }).archiveAndResetYear(namaArsip);
        }
    });
}


// ==========================================================================
    // FITUR IMPORT EXCEL HARI LIBUR
    // ==========================================================================
    
    function triggerImportLibur() {
        document.getElementById('fileInputLibur').click();
    }

function handleFileImportLibur(input) {
        const file = input.files[0];
        if (!file) return;

        showLoading(); 

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            
            // --- PERBAIKAN DISINI: Tambahkan cellDates: true ---
            // Opsi ini memaksa SheetJS mengubah angka Excel menjadi Date Object JS yang benar
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            // ----------------------------------------------------
            
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                hideLoading();
                showAlert('error', 'File Excel kosong atau format salah.');
                input.value = ''; 
                return;
            }

            // Validasi Header
            const firstRow = jsonData[0];
            const hasTanggal = firstRow.hasOwnProperty('Tanggal');
            const hasKet = firstRow.hasOwnProperty('Keterangan');

            if (!hasTanggal || !hasKet) {
                hideLoading();
                showAlert('error', 'Format Excel salah! Pastikan ada kolom header: Tanggal dan Keterangan.');
                input.value = '';
                return;
            }

            processImportLibur(jsonData, input);
        };

        reader.onerror = function() {
            hideLoading();
            showAlert('error', 'Gagal membaca file.');
            input.value = '';
        };

        reader.readAsArrayBuffer(file);
    }

function processImportLibur(data, inputElement) {
        // Helper: Mengubah Date Object JS ke string "YYYY-MM-DD"
        // Ini penting untuk mencegah tanggal mundur 1 hari karena perbedaan zona waktu
        const formatDateCorrectly = (dateInput) => {
            if (!dateInput) return "";
            
            // Jika input sudah berupa Date Object (karena cellDates: true)
            if (dateInput instanceof Date) {
                const year = dateInput.getFullYear();
                const month = String(dateInput.getMonth() + 1).padStart(2, '0');
                const day = String(dateInput.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
            
            // Jika masih string, kembalikan apa adanya
            return String(dateInput).trim();
        };

        // Mapping data Excel ke Format Backend
        const formattedData = data.map(row => {
            const clean = (val) => (val ? String(val).trim() : '');
            
            // Ambil tanggal dan format ulang
            let rawTanggal = row['Tanggal'];
            let fixedTanggal = formatDateCorrectly(rawTanggal);

            return {
                tanggal: fixedTanggal, 
                keterangan: clean(row['Keterangan'])
            };
        });

        gas.run
            .withSuccessHandler(res => {
                hideLoading();
                inputElement.value = ''; 
                
                if (res.success) {
                    loadKelolaAbsen(); 
                    let msg = `Berhasil: ${res.added}, Gagal/Duplikat: ${res.skipped}`;
                    showAlert('success', 'Import Hari Libur Selesai! ' + msg);
                } else {
                    showAlert('error', res.message);
                }
            })
            .withFailureHandler(err => {
                hideLoading();
                inputElement.value = '';
                showAlert('error', 'Error Server: ' + err);
            })
            .importHariLiburBulk(formattedData);
    }

// Tambahkan di bagian script

// ====================================
// FITUR DOWNLOAD KARTU MASSAL (BULK)
// ====================================
// 
// Helper: minta logo header Kartu Pelajar dari server (via UrlFetchApp di GAS)
// Dilakukan di server karena banyak CDN gambar tidak mengizinkan fetch() lintas domain dari browser (CORS).
function fetchKartuLogosFromServer() {
    return new Promise((resolve) => {
        gas.run
            .withSuccessHandler(res => resolve(res))
            .withFailureHandler(err => { console.warn('Gagal memuat logo dari server:', err); resolve({ success: false }); })
            .getKartuLogoBase64();
    });
}

// Ubah hasil base64 dari server menjadi dataURL + info dimensi (untuk jsPDF addImage)
async function buildLogoDataFromServer(logoObj) {
    if (!logoObj || !logoObj.base64) return null;
    const mime   = (logoObj.mimeType || 'image/png').toLowerCase();
    const format = mime.includes('jpeg') || mime.includes('jpg') ? 'JPEG' : mime.includes('webp') ? 'WEBP' : 'PNG';
    const dataUrl = `data:${mime};base64,${logoObj.base64}`;
    try {
        const dims = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload  = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = reject;
            img.src = dataUrl;
        });
        return { dataUrl, width: dims.width, height: dims.height, format };
    } catch (e) {
        console.warn('Gagal membaca dimensi logo:', e);
        return null;
    }
}

// Hitung dimensi tampil logo (mm) menjaga rasio aspek, dibatasi tinggi & lebar maksimum
function calcLogoDisplaySize(logoData, maxH, maxW) {
    if (!logoData || !logoData.width || !logoData.height) return null;
    let h = maxH;
    let w = h * (logoData.width / logoData.height);
    if (w > maxW) {
        w = maxW;
        h = w * (logoData.height / logoData.width);
    }
    return { w, h };
}

async function downloadKartuSiswaBulk() {
    // 1. Cek Filter & Data
    const filterKelas = document.getElementById('filterKelasSiswa').value;
    // Pastikan tableState.siswa.fullData ada
    const allSiswa = (tableState.siswa && tableState.siswa.fullData) ? tableState.siswa.fullData : [];

    if (!allSiswa || allSiswa.length === 0) {
        showAlert('error', 'Data siswa belum dimuat. Refresh data dulu.');
        return;
    }

    // 2. Filter Data
    let dataToPrint = allSiswa;
    if (filterKelas && filterKelas !== "") {
        dataToPrint = allSiswa.filter(s => s.kelas === filterKelas);
    }

    if (dataToPrint.length === 0) {
        showAlert('error', 'Tidak ada siswa ditemukan.');
        return;
    }

    // Konfirmasi
    const result = await Swal.fire({
        title: 'Cetak Kartu PRESENSI',
        text: `Mencetak ${dataToPrint.length} kartu (Portrait). Layout: 9 Kartu per Halaman (A4).`,
        icon: 'info',
        showCancelButton: true,
        confirmButtonText: 'Cetak Sekarang',
        cancelButtonText: 'Batal'
    });
    if (!result.isConfirmed) return;

    // 3. Proses PDF
    Swal.fire({
        title: 'Generate PDF...',
        html: 'Sedang menyusun kartu...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    setTimeout(async () => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('p', 'mm', 'a4');

            // --- MUAT LOGO HEADER (kiri & kanan) — diambil via server agar tidak terkendala CORS ---
            let logoKiriData = null, logoKananData = null;
            try {
                const logoRes = await fetchKartuLogosFromServer();
                if (logoRes && logoRes.success) {
                    logoKiriData  = await buildLogoDataFromServer(logoRes.kiri);
                    logoKananData = await buildLogoDataFromServer(logoRes.kanan);
                } else {
                    console.warn('Gagal memuat logo header dari server:', logoRes && logoRes.message);
                }
            } catch (e) { console.warn('Gagal memuat logo header:', e); }
            
            // --- KONFIGURASI GRID (PORTRAIT) ---
            const pageWidth = 210;  // Lebar A4
            const pageHeight = 297; // Tinggi A4
            const cardWidth = 54;   // Lebar Kartu ID Portrait
            const cardHeight = 86;  // Tinggi Kartu ID Portrait

            // Jarak antar kartu
            const gapX = 8;
            const gapY = 8;

            // Grid 3 kolom x 3 baris per halaman
            const cols = 3;
            const rows = 3;

            // Hitung Margin Otomatis
            const marginX = (pageWidth - ((cardWidth * cols) + (gapX * (cols - 1)))) / 2;
            const marginY = (pageHeight - ((cardHeight * rows) + (gapY * (rows - 1)))) / 2;

            let x = marginX;
            let y = marginY;
            let col = 0;
            let row = 0;

            // Temp div untuk QR Generator (Hidden)
            const tempDiv = document.createElement('div');
            // Gunakan absolute off-screen agar canvas tetap ter-render dengan benar oleh browser
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            tempDiv.style.top = '-9999px';
            document.body.appendChild(tempDiv);

            for (let i = 0; i < dataToPrint.length; i++) {
                const s = dataToPrint[i];

                // --- PERBAIKAN 1: BERSIHKAN DATA NO. KARTU (SANITIZER) ---
                // Mengambil hanya angka dan huruf, membuang spasi/karakter aneh.
                // QR yang dicetak sekarang encode No. Kartu (bukan NIS lagi).
                let rawNis = s.noKartu || "";
                let cleanNis = String(rawNis).replace(/[^a-zA-Z0-9]/g, "").trim();

                // ==========================================
                // DESAIN KARTU (PORTRAIT)
                // ==========================================
                const cx = x + (cardWidth / 2); // titik tengah horizontal kartu

                // 1. BACKGROUND & BORDER
                doc.setDrawColor(200, 200, 200); // Abu muda
                doc.setFillColor(255, 255, 255); // Putih
                doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

                // 2. HEADER BIRU
                doc.setFillColor(30, 58, 138); // Navy Blue
                doc.rect(x, y, cardWidth, 16, 'F');

                // Logo Kiri (menyesuaikan ukuran, maks tinggi 10mm / lebar 12mm)
                if (logoKiriData) {
                    const dimKiri = calcLogoDisplaySize(logoKiriData, 10, 12);
                    if (dimKiri) {
                        const lx = x + 1.5;
                        const ly = y + (16 - dimKiri.h) / 2;
                        try { doc.addImage(logoKiriData.dataUrl, logoKiriData.format, lx, ly, dimKiri.w, dimKiri.h); } catch (e) { console.warn('addImage logo kiri gagal:', e); }
                    }
                }

                // Logo Kanan (menyesuaikan ukuran, maks tinggi 10mm / lebar 12mm)
                if (logoKananData) {
                    const dimKanan = calcLogoDisplaySize(logoKananData, 10, 12);
                    if (dimKanan) {
                        const rx = x + cardWidth - 1.5 - dimKanan.w;
                        const ry = y + (16 - dimKanan.h) / 2;
                        try { doc.addImage(logoKananData.dataUrl, logoKananData.format, rx, ry, dimKanan.w, dimKanan.h); } catch (e) { console.warn('addImage logo kanan gagal:', e); }
                    }
                }

                // Teks Header
                doc.setTextColor(255, 255, 255);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(9);
                doc.text("KARTU PELAJAR", cx, y + 7, {align:'center'});

                doc.setFontSize(6);
                doc.setFont("helvetica", "normal");
                doc.text("SEKOLAH", cx, y + 12, {align:'center'});

                // Garis Aksen Emas
                doc.setFillColor(245, 158, 11); // Amber
                doc.rect(x, y + 16, cardWidth, 1, 'F');

                // 3. QR CODE (tengah, di bawah header)
                const qrSize = 32;
                const qrX = cx - (qrSize / 2);
                const qrY = y + 22;

                // --- PERBAIKAN 2: GENERATE QR DENGAN LEVEL 'L' ---
                tempDiv.innerHTML = ''; // Kosongkan dulu

                // Cek apakah data valid
                if(cleanNis) {
                    try {
                        new QRCode(tempDiv, {
                            text: cleanNis, // Gunakan data bersih
                            width: 160, height: 160,
                            // PENTING: Gunakan Level L agar muat data panjang tanpa error overflow
                            correctLevel: QRCode.CorrectLevel.L,
                            colorDark : "#000000", colorLight : "#ffffff"
                        });

                        // Ambil gambar dari canvas
                        const canvas = tempDiv.querySelector('canvas');
                        if(canvas) {
                            const qrUrl = canvas.toDataURL("image/png");
                            doc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);
                        }
                    } catch (e) {
                        console.error("Gagal buat QR untuk " + s.nama, e);
                    }
                }

                // Label kecil di bawah QR
                doc.setFontSize(5.5);
                doc.setTextColor(100, 116, 139);
                doc.text("Scan untuk Presensi", cx, qrY + qrSize + 4, {align:'center'});

                // 4. DATA SISWA (di bawah QR, rata tengah)
                let infoY = qrY + qrSize + 9;

                // NAMA
                doc.setFont("helvetica", "bold");
                doc.setFontSize(10);
                doc.setTextColor(30, 58, 138);
                let namaCetak = (s.nama || "").length > 22 ? (s.nama || "").substring(0, 22) + "..." : (s.nama || "");
                doc.text(namaCetak.toUpperCase(), cx, infoY, {align:'center'});

                // Garis pemisah
                infoY += 3;
                doc.setDrawColor(226, 232, 240);
                doc.line(x + 6, infoY, x + cardWidth - 6, infoY);

                // DETAIL — format "Label : Nilai" dalam satu baris, label & label sejajar antar baris
                const labelX = x + 9;
                const valueX = labelX + 13;

                infoY += 5;
                doc.setFontSize(7.5);
                // NO. KARTU (nilai yang di-encode ke QR di atas)
                doc.setFont("helvetica", "normal");
                doc.setTextColor(100, 116, 139);
                doc.text("No. Kartu", labelX, infoY);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);
                doc.text(": " + (cleanNis || "-"), valueX, infoY);

                // NIS (tetap dicetak buat referensi/login siswa, bukan buat scan)
                infoY += 5;
                doc.setFont("helvetica", "normal");
                doc.setTextColor(100, 116, 139);
                doc.text("NIS", labelX, infoY);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);
                doc.text(": " + String(s.nis || "-"), valueX, infoY);

                // KELAS
                infoY += 5.5;
                doc.setFont("helvetica", "normal");
                doc.setTextColor(100, 116, 139);
                doc.text("Kelas", labelX, infoY);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);
                doc.text(": " + String(s.kelas || "-"), valueX, infoY);

                // NO. ABSEN
                infoY += 5;
                doc.setFont("helvetica", "normal");
                doc.setTextColor(100, 116, 139);
                doc.text("Absen", labelX, infoY);
                doc.setFont("helvetica", "bold");
                doc.setTextColor(15, 23, 42);
                doc.text(": " + String(s.noAbsen || "-"), valueX, infoY);

                // ==========================================
                // GRID LOGIC
                // ==========================================
                col++;
                if (col >= cols) {
                    col = 0;
                    row++;
                    x = marginX;
                    y += cardHeight + gapY;
                } else {
                    x += cardWidth + gapX;
                }

                // Pindah Halaman
                if (row >= rows && i < dataToPrint.length - 1) {
                    doc.addPage();
                    col = 0;
                    row = 0;
                    x = marginX;
                    y = marginY;
                }
            }

            // Bersihkan elemen temp
            document.body.removeChild(tempDiv);
            
            const fileName = filterKelas ? `Kartu_${filterKelas}.pdf` : `Kartu_Semua_Siswa.pdf`;
            doc.save(fileName);

            Swal.fire({
                icon: 'success',
                title: 'Selesai!',
                text: 'PDF Kartu berhasil diunduh.',
                timer: 2000
            });
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Gagal membuat PDF: ' + error.message, 'error');
        }
    }, 500);
}

    function deleteGuruConfirm(username) {
        if (confirm(`Hapus akses untuk guru: ${username}?`)) {
            showLoading(); // Tampilkan overlay loading

            // --- KEAMANAN: AMBIL TOKEN USER ---
            const token = currentUser ? currentUser.token : null;
            // ----------------------------------

            gas.run.withSuccessHandler(r => {
                hideLoading();
                
                if (r.success) {
                    // Bersihkan cache data guru
                    tableState.guru.fullData = []; 
                    // Reload tabel
                    loadDataGuru();
                    showAlert('success', 'Akun guru berhasil dihapus');
                } else {
                    showAlert('error', r.message);
                }
            })
            .withFailureHandler(error => {
                hideLoading();
                showAlert('error', 'Gagal menghapus: ' + error);
            })
            .deleteGuru(token, username); // <-- Token dikirim
        }
    }

function handleArchiveAndReset() {
        const backupNameInput = document.getElementById('backupName');
        // Ambil value dan hapus spasi berlebih
        const backupName = backupNameInput ? backupNameInput.value.trim() : ''; 

        Swal.fire({
            title: 'Tutup Tahun Ajaran?',
            text: "Sistem akan membackup data saat ini (Presensi, Siswa, Kelas) lalu MERESET data utama untuk tahun ajaran baru. Tindakan ini tidak bisa dibatalkan!",
            icon: 'warning',
            input: 'text', // Opsional: Bisa minta input lagi disini atau pakai input form sebelumnya
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Ya, Tutup & Reset!',
            cancelButtonText: 'Batal'
        }).then((result) => {
            if (result.isConfirmed) {
                showLoading();
                
                // PANGGIL BACKEND
                gas.run
                    .withSuccessHandler(function(res) {
                        hideLoading();
                        if (res.success) {
                            Swal.fire({
                                title: 'Berhasil!',
                                text: res.message + '\nFile Backup: ' + res.backupName, // Tampilkan nama file
                                icon: 'success'
                            }).then(() => {
                                loadDashboardData(); // Refresh data
                            });
                        } else {
                            showAlert('error', res.message);
                        }
                    })
                    .withFailureHandler(function(err) {
                        hideLoading();
                        showAlert('error', 'Gagal server: ' + err);
                    })
                    .archiveAndReset(backupName); // <--- PERBAIKAN: Masukkan parameter backupName
            }
        });
    }

    // Fungsi untuk Tampilkan/Sembunyikan Password
    function togglePassword() {
        const passwordInput = document.getElementById('password');
        const toggleIcon = document.getElementById('togglePasswordIcon');

        if (passwordInput.type === 'password') {
            // Ubah ke Text (Tampilkan)
            passwordInput.type = 'text';
            toggleIcon.classList.remove('fa-eye');
            toggleIcon.classList.add('fa-eye-slash');
        } else {
            // Ubah ke Password (Sembunyikan)
            passwordInput.type = 'password';
            toggleIcon.classList.remove('fa-eye-slash');
            toggleIcon.classList.add('fa-eye');
        }
    }
    function downloadTemplate(type) {
        // Tampilkan loading overlay
        showLoading();
        
        gas.run
            .withSuccessHandler(function(res) {
                hideLoading();
                if (res.success) {
                    // Buka URL download di tab baru
                    window.open(res.url, '_blank');
                    // Beri notifikasi (Opsional)
                    // showAlert('success', 'Template ' + type + ' berhasil diunduh');
                } else {
                    showAlert('error', res.message);
                }
            })
            .withFailureHandler(function(err) {
                hideLoading();
                showAlert('error', 'Gagal: ' + err);
            })
            .getTemplateExcel(type);
    }
    function generateQRForSiswa(noKartu, nama, kelas) {
        loadQRCodeSiswa(noKartu, nama, kelas);
    }

    // ==========================================================================
    // 10. START APP
    // ==========================================================================
    // Ambil URL deployment dari server (untuk buka scanner dengan origin yang sama)
        // (getDeploymentUrl dihapus: URL scanner kini scanner.html di origin yang sama)

    // ==========================================================================
    // PRESENSI SHOLAT
    // ==========================================================================
    let sholatStudents  = [];  // [{nis, nama, kelas}]
    let sholatStatusMap = {};  // nis -> 'Hadir'|'Tidak Hadir'|'Izin / Uzur' (belum tersimpan, masih bisa diubah)
    let sholatKetMap    = {};  // nis -> string keterangan (belum tersimpan)
    let sholatLockedMap = {};  // nis -> { status, keterangan, jamAbsen } — SUDAH tersimpan di server, terkunci
    let sholatRekapData = [];  // data rekap saat ini
    let sholatFilterReqToken = 0;   // penanda request terbaru, cegah race condition antar-panggilan
    let sholatFilterTimeoutId = null; // guard timeout biar spinner gak nyangkut kalau server lambat

    function loadPresensiSholat() {
      if (typeof sholatStopPopup === 'function') sholatStopPopup();
      setActiveMenu('Presensi Sholat');
      showView('view-presensi-sholat');
      showSholatInput();

      // Set tanggal hari ini
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('sholatTanggal').value = today;

      // Isi dropdown kelas
      const selInput = document.getElementById('sholatKelas');
      const selRekap = document.getElementById('sholatRekapKelas');
      selInput.innerHTML = '<option value="">-- Pilih Kelas --</option>';
      selRekap.innerHTML = '<option value="">Semua Kelas</option>';

      if (currentUser.role === 'admin' || !currentUser.kelas) {
        // Admin, ATAU Guru dengan kelas kosong (= "Wali Kelas Semua Kelas" / akses semua)
        // -> ambil daftar kelas lengkap dari server, dengan cadangan localStorage buat offline.
        const isiOpsiKelasSholat = (list) => {
          selInput.innerHTML += `<option value="SEMUA">📋 Semua Kelas</option>`;
          list.forEach(k => {
            selInput.innerHTML += `<option value="${k}">${k}</option>`;
            selRekap.innerHTML += `<option value="${k}">${k}</option>`;
          });
          restoreLastKelasDipilih(selInput, 'sholat');
        };

        if (!navigator.onLine) {
          const cached = loadKelasListFromStorage('sholat');
          if (cached) isiOpsiKelasSholat(cached);
        } else {
          gas.run
            .withSuccessHandler(res => {
              const list = (res && res.success && res.data) ? res.data : [];
              try { localStorage.setItem('sholatKelasListBackup', JSON.stringify(list)); } catch(e) {}
              isiOpsiKelasSholat(list);
            })
            .withFailureHandler(() => {
              const cached = loadKelasListFromStorage('sholat');
              if (cached) isiOpsiKelasSholat(cached);
            })
            .getKelasList();
        }
      } else {
        // Guru dengan kelas spesifik (mis. "Kelas A,Kelas B")
        String(currentUser.kelas).split(',').map(k => k.trim()).filter(Boolean).forEach(k => {
          selInput.innerHTML += `<option value="${k}">${k}</option>`;
          selRekap.innerHTML += `<option value="${k}">${k}</option>`;
        });
      }

      // Set bulan rekap
      const ym = today.substring(0, 7);
      document.getElementById('sholatRekapBulan').value = ym;
    }

    function showSholatInput() {
      document.getElementById('sholatInputSection').classList.remove('hidden');
      document.getElementById('sholatRekapSection').classList.add('hidden');
    }

    function loadRekapSholatView() {
      document.getElementById('sholatInputSection').classList.add('hidden');
      document.getElementById('sholatRekapSection').classList.remove('hidden');
      loadRekapSholatData();
    }

    function onSholatFilterChange() {
      const tanggal = document.getElementById('sholatTanggal').value;
      const waktu   = document.getElementById('sholatWaktu').value;
      const kelas   = document.getElementById('sholatKelas').value;
      if (!tanggal || !waktu || !kelas) return;
      saveLastKelasDipilih('sholat', kelas);

      // Reset state
      sholatStudents  = [];
      sholatStatusMap = {};
      sholatKetMap    = {};
      sholatLockedMap = {};
      updateSholatCounter();
      document.getElementById('sholatSubmitBtn').classList.add('hidden');
      document.getElementById('sholatInfoText').textContent = '';
      document.getElementById('sholatSubmittedBanner').classList.add('hidden');

      const isSemua = (kelas === 'SEMUA');
      const colSpan = isSemua ? 5 : 4;
      const tbody = document.getElementById('sholatTbody');
      tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center"><div class="inline-block w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div><p class="text-xs text-gray-400 mt-2">Memuat data siswa...</p></td></tr>`;
      document.getElementById('sholatSubtitle').textContent = `${isSemua ? 'Semua Kelas' : kelas} — ${waktu} — ${tanggal}`;

      // Guard timeout: kalau server gak balas dalam 15 detik (macet/lambat, bukan error),
      // withFailureHandler TIDAK otomatis kepanggil -> tanpa ini spinner nyangkut selamanya.
      const reqToken = ++sholatFilterReqToken;
      clearTimeout(sholatFilterTimeoutId);
      sholatFilterTimeoutId = setTimeout(() => {
        if (reqToken !== sholatFilterReqToken) return; // request lama, sudah kesusul request baru
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-10 text-center text-red-400 text-sm">
          Server lambat merespons.<br>
          <button onclick="onSholatFilterChange()" class="mt-2 text-xs underline text-emerald-600">Coba lagi</button>
        </td></tr>`;
      }, 15000);

      // Ambil siswa: null = semua kelas, atau filter per kelas -- dengan cadangan
      // localStorage per kelas biar tetap muncul walau offline / gagal konek.
      const sholatSiswaCacheKey = 'sholatSiswaByKelas:' + (isSemua ? 'SEMUA' : kelas);
      const fromSholatSiswaCache = () => {
        try {
          const raw = localStorage.getItem(sholatSiswaCacheKey);
          if (raw) return JSON.parse(raw);
        } catch (e) {}
        return null;
      };
      const showSlowTimeout = () => {
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-10 text-center text-red-400 text-sm">
          Server lambat merespons.<br>
          <button onclick="onSholatFilterChange()" class="mt-2 text-xs underline text-emerald-600">Coba lagi</button>
        </td></tr>`;
      };

      // ---- (a) Data presensi yang SUDAH tersimpan: dikirim LANGSUNG, paralel dengan daftar siswa ----
      // (dulu menunggu daftar siswa selesai dulu -> dua kali tunggu server berurutan)
      let existingState = 'pending'; // 'pending' | 'ok' | 'fail'
      let existingData  = null;
      let onExistingReady = null;
      gas.run
        .withSuccessHandler(existing => { existingState = 'ok'; existingData = existing; if (onExistingReady) onExistingReady(); })
        .withFailureHandler(() => { existingState = 'fail'; if (onExistingReady) onExistingReady(); })
        .getPresensiSholatByKelas(kelas, tanggal, waktu);

      const lockFromServer = (s, m) => ({
        status: m.status,
        keterangan: m.keterangan || '',
        jamAbsen: m.jamAbsen || ''
      });

      // Dipanggil setelah daftar siswa DAN data tersimpan sama-sama siap
      const applyExisting = () => {
        if (reqToken !== sholatFilterReqToken) return;
        clearTimeout(sholatFilterTimeoutId);
        if (existingState === 'fail') {
          sholatStudents.forEach(s => { sholatStatusMap[s.nis] = ''; sholatKetMap[s.nis] = ''; });
          renderSholatTable(isSemua);
          document.getElementById('sholatSubmitBtn').classList.remove('hidden');
          return;
        }
        try {
          const existing = existingData || {};
          const map = (existing.success && existing.data) ? existing.data : {};
          const hadData = Object.keys(map).length > 0;
          if (hadData) document.getElementById('sholatSubmittedBanner').classList.remove('hidden');

          sholatLockedMap = {};
          sholatStudents.forEach(s => {
            if (map[s.nis]) {
              // Sudah tersimpan di server -> terkunci, tidak bisa diubah/scan ulang
              sholatLockedMap[s.nis] = lockFromServer(s, map[s.nis]);
            } else {
              sholatStatusMap[s.nis] = '';
              sholatKetMap[s.nis]    = '';
            }
          });
          renderSholatTable(isSemua);
          document.getElementById('sholatSubmitBtn').classList.remove('hidden');
          document.getElementById('sholatInfoText').textContent = `${sholatStudents.length} siswa dimuat`;
        } catch (jsErr) {
          // Exception JS di sini TIDAK ditangkap withFailureHandler (itu cuma nangkep error server GAS).
          // Tanpa try/catch ini, tbody nyangkut selamanya di spinner tanpa pesan apa pun.
          console.error('sholat render error:', jsErr);
          tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-10 text-center text-red-400 text-sm">
            Error render: ${jsErr.message || jsErr}<br>
            <button onclick="onSholatFilterChange()" class="mt-2 text-xs underline text-emerald-600">Coba lagi</button>
          </td></tr>`;
        }
      };

      const lanjutkanSetelahSiswa = (res) => {
        if (reqToken !== sholatFilterReqToken) return;
        clearTimeout(sholatFilterTimeoutId);
        if (!res.success || !res.data.length) {
          tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-12 text-center text-gray-400 text-sm">Tidak ada siswa ditemukan untuk kelas ini.</td></tr>`;
          return;
        }
        sholatStudents = res.data;
        if (existingState === 'pending') {
          // Data tersimpan belum datang -> tunggu, dengan guard timeout tahap kedua
          sholatFilterTimeoutId = setTimeout(() => {
            if (reqToken !== sholatFilterReqToken) return;
            showSlowTimeout();
          }, 15000);
          onExistingReady = applyExisting;
        } else {
          applyExisting();
        }
      };

      // Daftar siswa terbaru tiba SETELAH tabel tampil dari cache: perbarui tanpa mengganggu input
      const terapkanSiswaTerbaru = (res) => {
        if (reqToken !== sholatFilterReqToken) return;
        if (!res || !res.success || !res.data || !res.data.length) return;
        sholatStudents = res.data;
        if (existingState === 'pending') return; // tabel belum digambar; applyExisting akan memakai data baru ini
        const map = (existingState === 'ok' && existingData && existingData.success && existingData.data) ? existingData.data : {};
        sholatStudents.forEach(s => {
          if (map[s.nis]) {
            sholatLockedMap[s.nis] = lockFromServer(s, map[s.nis]);
            delete sholatStatusMap[s.nis];
          } else if (!(s.nis in sholatLockedMap) && !(s.nis in sholatStatusMap)) {
            sholatStatusMap[s.nis] = '';
            sholatKetMap[s.nis]    = '';
          }
        });
        renderSholatTable(isSemua);
        document.getElementById('sholatInfoText').textContent = `${sholatStudents.length} siswa dimuat`;
      };

      if (!navigator.onLine) {
        const cached = fromSholatSiswaCache();
        clearTimeout(sholatFilterTimeoutId);
        if (cached) {
          lanjutkanSetelahSiswa(cached);
        } else {
          tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-12 text-center text-red-400 text-sm">Offline & belum ada data siswa tersimpan untuk kelas ini. Buka menu ini sekali saat online dulu.</td></tr>`;
        }
        return;
      }

      // ---- (b) Daftar siswa: cache tampil duluan (stale-while-revalidate), data terbaru menyusul ----
      const cachedSiswa = fromSholatSiswaCache();
      const punyaCache = !!(cachedSiswa && cachedSiswa.success && cachedSiswa.data && cachedSiswa.data.length);
      if (punyaCache) {
        clearTimeout(sholatFilterTimeoutId);
        lanjutkanSetelahSiswa(cachedSiswa);
      }
      gas.run
        .withSuccessHandler(res => {
          try { localStorage.setItem(sholatSiswaCacheKey, JSON.stringify(res)); } catch (e) {}
          if (punyaCache) {
            if (JSON.stringify(res.data) !== JSON.stringify(cachedSiswa.data)) terapkanSiswaTerbaru(res);
          } else {
            lanjutkanSetelahSiswa(res);
          }
        })
        .withFailureHandler(err => {
          if (punyaCache) return; // tabel sudah tampil dari cache
          if (reqToken !== sholatFilterReqToken) return;
          clearTimeout(sholatFilterTimeoutId);
          const cached = fromSholatSiswaCache();
          if (cached) { lanjutkanSetelahSiswa(cached); return; }
          tbody.innerHTML = `<tr><td colspan="${colSpan}" class="py-8 text-center text-red-400 text-sm">Gagal memuat: ${err}</td></tr>`;
        })
        .getSiswaList(isSemua ? null : kelas);
    }

    function renderSholatTable(showKelas = false) {
      const tbody = document.getElementById('sholatTbody');
      if (!sholatStudents.length) {
        tbody.innerHTML = `<tr><td colspan="${showKelas ? 5 : 4}" class="py-12 text-center text-gray-400">Tidak ada siswa</td></tr>`;
        return;
      }
      tbody.innerHTML = sholatStudents.map((s, i) => {
        const lockedData = sholatLockedMap[s.nis] || null;
        const locked = lockedData !== null;

        const kelasCol = showKelas ? `<td class="px-3 py-3 text-center text-[10px] text-gray-500 font-semibold">${s.kelas || '-'}</td>` : '';

        if (locked) {
          const statusBadgeCfg = {
            'Hadir':        { bg: 'bg-emerald-500', label: '✓ Hadir' },
            'Tidak Hadir':  { bg: 'bg-red-500',      label: '✗ Absen' },
            'Izin / Uzur':  { bg: 'bg-blue-500',     label: '⚬ Izin' }
          };
          const cfg = statusBadgeCfg[lockedData.status] || { bg: 'bg-gray-400', label: lockedData.status || '?' };
          return `
          <tr class="border-b border-gray-50 bg-gray-50 opacity-70" id="sholat-row-${s.nis}">
            <td class="px-3 py-3 text-center text-gray-400 text-[10px]">${i+1}</td>
            <td class="px-4 py-3">
              <p class="font-semibold text-xs text-gray-800">${s.nama}</p>
              <p class="text-[10px] text-gray-400">${s.nis}</p>
            </td>
            ${kelasCol}
            <td class="px-3 py-3 text-center">
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold text-white ${cfg.bg}">
                <i class="fas fa-lock text-[8px]"></i> ${cfg.label}
              </span>
              <div class="text-[9px] text-gray-400 mt-1">${lockedData.jamAbsen ? '🕐 ' + lockedData.jamAbsen : 'Sudah tercatat'}</div>
            </td>
            <td class="px-3 py-3 text-[10px] text-gray-400 italic">${lockedData.keterangan || '-'}</td>
          </tr>`;
        }

        const st  = sholatStatusMap[s.nis] || '';
        const ket = sholatKetMap[s.nis] || '';
        const hadir    = st === 'Hadir'        ? 'ring-2 ring-emerald-400 bg-emerald-50 text-emerald-700 font-bold' : 'text-gray-600 hover:bg-gray-50';
        const tidakH   = st === 'Tidak Hadir'  ? 'ring-2 ring-red-400 bg-red-50 text-red-700 font-bold'            : 'text-gray-600 hover:bg-gray-50';
        const izin     = st === 'Izin / Uzur'  ? 'ring-2 ring-blue-400 bg-blue-50 text-blue-700 font-bold'         : 'text-gray-600 hover:bg-gray-50';
        const rowBg    = st === 'Hadir' ? 'bg-emerald-50/30' : st === 'Tidak Hadir' ? 'bg-red-50/20' : '';
        return `
        <tr class="border-b border-gray-50 ${rowBg}" id="sholat-row-${s.nis}">
          <td class="px-3 py-3 text-center text-gray-400 text-[10px]">${i+1}</td>
          <td class="px-4 py-3">
            <p class="font-semibold text-xs text-gray-800">${s.nama}</p>
            <p class="text-[10px] text-gray-400">${s.nis}</p>
          </td>
          ${kelasCol}
          <td class="px-3 py-3">
            <div class="flex gap-1 justify-center">
              <button onclick="setSholatStatus('${s.nis}','Hadir')"
                class="text-[10px] px-2 py-1 rounded-lg border transition ${hadir}">✓ Hadir</button>
              <button onclick="setSholatStatus('${s.nis}','Tidak Hadir')"
                class="text-[10px] px-2 py-1 rounded-lg border transition ${tidakH}">✗ Absen</button>
              <button onclick="setSholatStatus('${s.nis}','Izin / Uzur')"
                class="text-[10px] px-2 py-1 rounded-lg border transition ${izin}">⚬ Izin</button>
            </div>
          </td>
          <td class="px-3 py-3">
            <select onchange="sholatKetMap['${s.nis}']=this.value"
              class="w-full border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:ring-1 focus:ring-emerald-300 outline-none bg-gray-50 focus:bg-white cursor-pointer">
              <option value="" ${ket === '' ? 'selected' : ''}>- Tidak ada -</option>
              <option value="Haid" ${ket === 'Haid' ? 'selected' : ''}>Haid</option>
              <option value="Kegiatan Lain" ${ket === 'Kegiatan Lain' ? 'selected' : ''}>Kegiatan Lain</option>
              <option value="Lain-lain" ${ket === 'Lain-lain' ? 'selected' : ''}>Lain-lain</option>
            </select>
          </td>
        </tr>`;
      }).join('');
      updateSholatCounter();
    }

    function setSholatStatus(nis, status) {
      if (sholatLockedMap[nis]) return; // sudah terkunci, tidak bisa diubah
      sholatStatusMap[nis] = status;
      const kelas = document.getElementById('sholatKelas').value;
      renderSholatTable(kelas === 'SEMUA');
      updateSholatCounter();
    }

    function sholatTandaiSemua(status) {
      sholatStudents.forEach(s => { if (!sholatLockedMap[s.nis]) sholatStatusMap[s.nis] = status; });
      const kelas = document.getElementById('sholatKelas').value;
      renderSholatTable(kelas === 'SEMUA');
    }

    function updateSholatCounter() {
      const hadirBaru = Object.values(sholatStatusMap).filter(v => v === 'Hadir').length;
      const totalTerkunci = Object.keys(sholatLockedMap).filter(k => sholatStudents.find(s => s.nis === k)).length;
      const total = sholatStudents.length;
      document.getElementById('sholatCounter').textContent = `${hadirBaru} baru / ${total} total (${totalTerkunci} terkunci)`;
    }

    // ==========================================================================
    // SCAN QR — PRESENSI SHOLAT (admin & guru): scan -> langsung tertandai Hadir
    // ==========================================================================
    let sholatCameraPopup     = null;
    let sholatPollingInterval = null;
    const SHOLAT_LS_KEY       = 'sholat_qr_result';

    // Listener postMessage dari popup kamera Sholat
    window.addEventListener('message', function(event) {
        if (!event.data || event.data.type !== 'SHOLAT_QR_SCAN_RESULT') return;
        const kodeKartu = event.data.nis;
        if (!kodeKartu || typeof kodeKartu !== 'string') return;
        if (event.data.ts && (Date.now() - event.data.ts) > 30000) return;
        sholatOnScanResult(kodeKartu); // feedback ke popup (sukses/duplikat/error) dikirim dari dalam fungsi ini
    });

    function sholatStopPolling() {
        if (sholatPollingInterval) { clearInterval(sholatPollingInterval); sholatPollingInterval = null; }
        const ps = document.getElementById('sholatPollingStatus');
        if (ps) ps.classList.add('hidden');
        const btn = document.getElementById('sholatCamBtn');
        if (btn) {
            btn.classList.remove('hidden');
            btn.innerHTML = '<i class="fas fa-camera text-base"></i> Buka Kamera Live';
        }
    }

    function sholatStartPolling() {
        sholatStopPolling();
        try { localStorage.removeItem(SHOLAT_LS_KEY); } catch(e) {}
        const ps = document.getElementById('sholatPollingStatus');
        if (ps) ps.classList.remove('hidden');
        const btn = document.getElementById('sholatCamBtn');
        if (btn) btn.classList.add('hidden');

        sholatPollingInterval = setInterval(() => {
            if (sholatCameraPopup && sholatCameraPopup.closed) {
                sholatCameraPopup = null;
                sholatStopPolling();
                return;
            }
            try {
                const raw = localStorage.getItem(SHOLAT_LS_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (Date.now() - data.ts > 30000) { localStorage.removeItem(SHOLAT_LS_KEY); return; }
                localStorage.removeItem(SHOLAT_LS_KEY);
                sholatOnScanResult(data.nis);
            } catch(e) {}
        }, 300);
    }

    function sholatStopPopup() {
        if (sholatCameraPopup && !sholatCameraPopup.closed) { sholatCameraPopup.close(); sholatCameraPopup = null; }
        sholatStopPolling();
    }

    function sholatOpenCameraPopup() {
        const tanggal = document.getElementById('sholatTanggal').value;
        const waktu   = document.getElementById('sholatWaktu').value;
        const kelas   = document.getElementById('sholatKelas').value;
        if (!tanggal || !waktu || !kelas || !sholatStudents.length) {
            showAlert('error', 'Pilih tanggal, waktu sholat, dan kelas dahulu, lalu klik "Tampilkan Siswa".');
            return;
        }

        try { localStorage.removeItem(SHOLAT_LS_KEY); } catch(e) {}

        const lsKeyVal   = SHOLAT_LS_KEY;
        const labelKelas = kelas === 'SEMUA' ? 'Semua Kelas' : kelas;
        const popupHTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scan QR - Presensi Sholat</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#052e2b;color:white;font-family:'Segoe UI',sans-serif;
       display:flex;flex-direction:column;align-items:center;
       min-height:100vh;padding:8px 10px;gap:6px;overflow-x:hidden;}
  h2{font-size:11px;font-weight:700;color:#e2e8f0;letter-spacing:1px;margin-top:2px;}

  #scanNotif{display:none;position:fixed;top:0;left:0;right:0;z-index:999;
    padding:8px 14px 10px;text-align:center;
    border-bottom:1px solid rgba(255,255,255,.1);
    box-shadow:0 4px 20px rgba(0,0,0,.5);}
  #scanNotif.ok {background:linear-gradient(135deg,#065f46,#047857);display:block;}
  #scanNotif.err{background:linear-gradient(135deg,#7f1d1d,#b91c1c);display:block;}
  #scanNotif.pop{animation:popIn .3s cubic-bezier(.4,0,.2,1);}
  @keyframes popIn{0%{transform:translateY(-30px);opacity:0}100%{transform:translateY(0);opacity:1}}
  .n-label{font-size:8px;text-transform:uppercase;letter-spacing:1px;opacity:.5;color:#fff;margin-bottom:1px;}
  .n-icon{font-size:18px;display:block;line-height:1;margin-bottom:1px;}
  .n-nama{font-size:13px;font-weight:800;color:#fff;}

  #flashOverlay{display:none;position:fixed;inset:0;z-index:998;pointer-events:none;border:4px solid transparent;}
  #flashOverlay.ok {display:block;border-color:#10b981;animation:ff .5s ease forwards;}
  #flashOverlay.err{display:block;border-color:#ef4444;animation:ff .5s ease forwards;}
  @keyframes ff{0%{opacity:1}100%{opacity:0}}

  #kelasBadge{background:#047857;border:1px solid #065f46;border-radius:8px;
    padding:4px 12px;font-size:10px;font-weight:700;color:#fff;letter-spacing:.5px;}

  #videoWrap{position:relative;width:100%;max-width:300px;}
  video{width:100%;border-radius:10px;display:block;background:#000;min-height:160px;object-fit:cover;}
  canvas{display:none;}

  .overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}
  .box{width:150px;height:150px;position:relative;}
  .corner{position:absolute;width:20px;height:20px;border-color:#34d399;border-style:solid;}
  .tl{top:0;left:0;border-width:3px 0 0 3px;border-radius:5px 0 0 0;}
  .tr{top:0;right:0;border-width:3px 3px 0 0;border-radius:0 5px 0 0;}
  .bl{bottom:0;left:0;border-width:0 0 3px 3px;border-radius:0 0 0 5px;}
  .br{bottom:0;right:0;border-width:0 3px 3px 0;border-radius:0 0 5px 0;}
  .scanline{position:absolute;left:3px;right:3px;height:2px;
    background:linear-gradient(90deg,transparent,#34d399,#059669,#34d399,transparent);
    top:6px;border-radius:2px;animation:scan 1.6s ease-in-out infinite;}
  @keyframes scan{0%{top:4px;opacity:1}100%{top:140px;opacity:.2}}
  .box.found .corner{border-color:#4ade80;}
  .box.found .scanline{background:linear-gradient(90deg,transparent,#4ade80,transparent);}

  #status{font-size:11px;color:#94a3b8;text-align:center;max-width:300px;min-height:28px;line-height:1.5;padding:0 6px;}
  #status.ok{color:#4ade80;font-weight:700;font-size:13px;}
  #status.err{color:#f87171;}

  #loading{color:#64748b;font-size:12px;text-align:center;}
  .spinner{width:28px;height:28px;border:3px solid #064e3b;border-top:3px solid #34d399;
    border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px;}
  @keyframes spin{to{transform:rotate(360deg);}}

  .btns{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;width:100%;max-width:300px;}
  button{flex:1;min-width:80px;background:#059669;color:white;border:none;
    padding:9px 10px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;transition:background .2s;}
  button:hover{background:#047857;}
  button.sec{background:#0f2f28;border:1px solid #134e42;}
  button.sec:hover{background:#134e42;}
  button.retry{background:#059669;}
  button.retry:hover{background:#047857;}
</style>
</head>
<body>

<div id="scanNotif">
  <div class="n-label">Terakhir Di-scan</div>
  <span class="n-icon" id="nIcon">✅</span>
  <div class="n-nama" id="nNama"></div>
</div>
<div id="flashOverlay"></div>

<h2>&#128247; SCAN QR — PRESENSI SHOLAT</h2>
<div id="kelasBadge">🕌 ${labelKelas} · ${waktu}</div>

<div id="loading">
  <div class="spinner"></div>
  <span>Meminta izin kamera...</span>
</div>

<div id="videoWrap" style="display:none">
  <video id="video" autoplay playsinline muted></video>
  <canvas id="canvas"></canvas>
  <canvas id="canvas2" style="display:none"></canvas>
  <div class="overlay">
    <div class="box" id="aimBox">
      <div class="corner tl"></div><div class="corner tr"></div>
      <div class="corner bl"></div><div class="corner br"></div>
      <div class="scanline"></div>
    </div>
  </div>
</div>

<div id="status">Arahkan QR siswa ke kamera</div>

<div class="btns">
  <button onclick="switchCam()">&#128260; Ganti Kamera</button>
  <button class="sec" onclick="window.close()">&#10005; Tutup</button>
</div>

<script>
var LS_KEY='${lsKeyVal}';
var stream=null, facing='environment', scanLoop=null, lastScan=0, isSendingResult=false;
var video=document.getElementById('video');
var canvas=document.getElementById('canvas');
var canvas2=document.getElementById('canvas2');
var ctx=canvas.getContext('2d',{willReadFrequently:true});
var ctx2=canvas2.getContext('2d',{willReadFrequently:true});
var statusEl=document.getElementById('status');
var loading=document.getElementById('loading');
var wrap=document.getElementById('videoWrap');
var aimBox=document.getElementById('aimBox');

async function startCam(f){
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    if(scanLoop){ clearInterval(scanLoop); scanLoop=null; }
    loading.style.display='block'; wrap.style.display='none';
    statusEl.className=''; statusEl.textContent='Memulai kamera...';
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:f==='environment'?{ideal:'environment'}:'user',width:{ideal:1280},height:{ideal:720}}
    });
    video.srcObject=stream;
    await new Promise((res,rej)=>{
      video.onloadedmetadata=()=>video.play().then(res).catch(rej);
      setTimeout(()=>rej(new Error('Timeout')),8000);
    });
    loading.style.display='none'; wrap.style.display='block';
    statusEl.textContent='Arahkan QR siswa ke kamera';
    beginScan();
  }catch(e){
    loading.style.display='none';
    statusEl.className='err';
    statusEl.innerHTML='Kamera gagal: '+e.name+'<br><small>'+e.message+'</small>';
    document.querySelector('.btns').innerHTML=
      '<button class="retry" onclick="startCam(facing)">&#128260; Coba Lagi</button>'+
      '<button class="sec" onclick="window.close()">&#10005; Tutup</button>';
  }
}

function switchCam(){ facing=facing==='environment'?'user':'environment'; startCam(facing); }

function beginScan(){
  if(typeof ZXing!=='undefined'){
    runZXing();
  } else {
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/umd/index.min.js';
    s.onload=runZXing;
    s.onerror=runJsQR;
    document.head.appendChild(s);
  }
}

function runZXing(){
  try{
    var hints=new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
    hints.set(ZXing.DecodeHintType.ALSO_INVERTED,true);
    var reader=new ZXing.BrowserQRCodeReader(hints);
    scanLoop=setInterval(function(){
      if(video.readyState<video.HAVE_ENOUGH_DATA||isSendingResult)return;
      var W=video.videoWidth,H=video.videoHeight;
      canvas.width=W;canvas.height=H;
      ctx.drawImage(video,0,0,W,H);
      try{
        var lum=new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        var bmp=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
        var r=reader.decodeBitmap(bmp);
        if(r&&r.getText()){onDetected(r.getText());return;}
      }catch(e){}
      try{
        canvas2.width=W;canvas2.height=H;
        ctx2.filter='contrast(2) brightness(1.15)';
        ctx2.drawImage(video,0,0,W,H);
        ctx2.filter='none';
        var lum2=new ZXing.HTMLCanvasElementLuminanceSource(canvas2);
        var bmp2=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum2));
        var r2=reader.decodeBitmap(bmp2);
        if(r2&&r2.getText()){onDetected(r2.getText());return;}
      }catch(e){}
      try{
        var cw=Math.round(W*0.65),ch=Math.round(H*0.65);
        var cx=Math.round((W-cw)/2),cy=Math.round((H-ch)/2);
        canvas2.width=cw;canvas2.height=ch;
        ctx2.filter='none';
        ctx2.drawImage(video,cx,cy,cw,ch,0,0,cw,ch);
        var lum3=new ZXing.HTMLCanvasElementLuminanceSource(canvas2);
        var bmp3=new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum3));
        var r3=reader.decodeBitmap(bmp3);
        if(r3&&r3.getText()){onDetected(r3.getText());return;}
      }catch(e){}
    },120);
  }catch(e){ runJsQR(); }
}

function runJsQR(){
  var s=document.createElement('script');
  s.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  s.onload=function(){
    scanLoop=setInterval(function(){
      if(video.readyState<video.HAVE_ENOUGH_DATA||isSendingResult)return;
      var W=video.videoWidth,H=video.videoHeight;
      canvas.width=W;canvas.height=H;
      ctx.drawImage(video,0,0,W,H);
      var d=ctx.getImageData(0,0,W,H);
      var r=jsQR(d.data,W,H,{inversionAttempts:'attemptBoth'});
      if(r&&r.data) onDetected(r.data);
    },120);
  };
  document.head.appendChild(s);
}

function onDetected(text){
  var now=Date.now();
  if(now-lastScan<2000)return;
  lastScan=now;
  aimBox.classList.add('found');
  setTimeout(()=>aimBox.classList.remove('found'),600);
  handleResult(text);
}

window.addEventListener('message',function(ev){
  if(!ev.data)return;
  if(ev.data.type==='SHOLAT_SCAN_SUCCESS')
    showNotif('ok','✅',ev.data.nama||'Berhasil');
  else if(ev.data.type==='SHOLAT_SCAN_ERROR')
    showNotif('err','❌',ev.data.message||'NIS tidak ditemukan');
});

function showNotif(type,icon,teks){
  var n=document.getElementById('scanNotif');
  var f=document.getElementById('flashOverlay');
  if(!n)return;
  document.getElementById('nIcon').textContent=icon;
  document.getElementById('nNama').textContent=teks;
  n.className=''; void n.offsetWidth; n.className=type+' pop';
  if(f){ f.className=''; void f.offsetWidth; f.className=type==='ok'?'ok':'err';
    setTimeout(()=>f.className='',550); }
}

function handleResult(text){
  if(!text||text.trim()===''||isSendingResult)return;
  isSendingResult=true;
  statusEl.className='ok';
  statusEl.textContent='✓ Terdeteksi! Mengirim...';
  var nis=text.trim();
  try{
    if(window.opener&&!window.opener.closed)
      window.opener.postMessage({type:'SHOLAT_QR_SCAN_RESULT',nis:nis,ts:Date.now()},'*');
  }catch(e){}
  try{ localStorage.setItem(LS_KEY,JSON.stringify({nis:nis,ts:Date.now()})); }catch(e){}
  setTimeout(function(){
    statusEl.className='';
    statusEl.textContent='Siap scan siswa berikutnya...';
    isSendingResult=false;
    lastScan=Date.now();
  },1800);
}

startCam(facing);
<\/script>
</body>
</html>`;

        const w = Math.min(360, screen.width - 40);
        const h = Math.min(500, screen.height - 60);
        const left = Math.round((screen.width - w) / 2);
        const top  = Math.round((screen.height - h) / 2);

        sholatCameraPopup = window.open('', 'sholat_qr_cam', `width=${w},height=${h},top=${top},left=${left},resizable=yes`);

        if (!sholatCameraPopup) {
            showAlert('error', 'Popup diblokir! Klik ikon di URL bar → Izinkan popup, lalu coba lagi.');
            return;
        }

        try {
            sholatCameraPopup.document.open();
            sholatCameraPopup.document.write(popupHTML);
            sholatCameraPopup.document.close();
        } catch(e) {
            const blob = new Blob([popupHTML], { type: 'text/html' });
            sholatCameraPopup.location.href = URL.createObjectURL(blob);
        }

        sholatStartPolling();
    }

    /**
     * Buka jendela "Tap Kartu Anda" khusus Presensi Sholat -- sama seperti versi
     * Daftar Hadir, tapi pakai messageType 'SHOLAT_QR_SCAN_RESULT' biar
     * ketangkep listener yang sudah ada (lihat listener SHOLAT_QR_SCAN_RESULT).
     */
    function sholatOpenTapKartuPopup() {
        const tanggal = document.getElementById('sholatTanggal').value;
        const waktu   = document.getElementById('sholatWaktu').value;
        const kelas   = document.getElementById('sholatKelas').value;
        if (!tanggal || !waktu || !kelas || !sholatStudents.length) {
            showAlert('error', 'Pilih tanggal, waktu sholat, dan kelas dahulu, lalu klik "Tampilkan Siswa".');
            return;
        }

        const w = Math.min(480, screen.width - 40);
        const h = Math.min(640, screen.height - 60);
        const left = Math.round((screen.width - w) / 2);
        const top  = Math.round((screen.height - h) / 2);

        // Window dibuka DULU (sinkron, langsung dari klik user) biar gak keblokir
        // popup-blocker browser -- isinya baru ditulis belakangan setelah waktu server didapat.
        sholatCameraPopup = window.open('', 'sholat_tap_kartu', `width=${w},height=${h},top=${top},left=${left},resizable=yes`);

        if (!sholatCameraPopup) {
            showAlert('error', 'Popup diblokir! Klik ikon di URL bar → Izinkan popup, lalu coba lagi.');
            return;
        }

        const tulisKontenPopup = (offsetMs) => {
            const popupHTML = buildTapKartuPopupHtml('SHOLAT_QR_SCAN_RESULT', 'Presensi Sholat', offsetMs);
            try {
                sholatCameraPopup.document.open();
                sholatCameraPopup.document.write(popupHTML);
                sholatCameraPopup.document.close();
            } catch (e) {
                const blob = new Blob([popupHTML], { type: 'text/html' });
                sholatCameraPopup.location.href = URL.createObjectURL(blob);
            }
        };

        gas.run
            .withSuccessHandler(res => {
                const offset = (res && res.success) ? (res.epochMs - Date.now()) : 0;
                tulisKontenPopup(offset);
            })
            .withFailureHandler(() => tulisKontenPopup(0)) // offline/gagal -> pakai jam device apa adanya
            .getServerTime();
    }

    // Dipanggil saat QR berhasil discan (dari popup) ATAU input manual — langsung tandai Hadir
    function sholatOnScanResult(rawKode) {
        const kodeKartu = String(rawKode).replace(/[^a-zA-Z0-9]/g,'').trim();
        const notif = document.getElementById('sholatScanNotif');
        const tampilkanNotif = (cls, text) => {
            if (!notif) return;
            notif.className = 'rounded-xl p-3 text-sm font-semibold text-center ' + cls;
            notif.textContent = text;
            notif.classList.remove('hidden');
            setTimeout(() => notif.classList.add('hidden'), 2200);
        };

        if (!sholatStudents.length) {
            if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
            tampilkanNotif('bg-yellow-50 text-yellow-700 border border-yellow-100', '⚠️ Pilih tanggal, waktu, dan kelas terlebih dahulu');
            return;
        }

        const siswa = sholatStudents.find(s => s.noKartu && s.noKartu === kodeKartu);
        if (!siswa) {
            if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
            tampilkanNotif('bg-red-50 text-red-600 border border-red-100', '❌ No. Kartu [' + kodeKartu + '] tidak ada di daftar ini');
            if (sholatCameraPopup && !sholatCameraPopup.closed) {
                try { sholatCameraPopup.postMessage({ type: 'SHOLAT_SCAN_ERROR', message: 'No. Kartu tidak ada di daftar ini' }, '*'); } catch(e) {}
            }
            return;
        }
        const nis = siswa.nis; // NIS asli, dipakai buat semua pencatatan di bawah

        if (sholatLockedMap[nis]) {
            // Sudah discan & tersimpan sebelumnya di server -> terkunci
            if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
            const st = sholatLockedMap[nis].status || 'tercatat';
            const jam = sholatLockedMap[nis].jamAbsen ? (' pukul ' + sholatLockedMap[nis].jamAbsen) : '';
            tampilkanNotif('bg-yellow-50 text-yellow-700 border border-yellow-100', '🔒 ' + siswa.nama + ' sudah tercatat ' + st + jam);
            if (sholatCameraPopup && !sholatCameraPopup.closed) {
                try { sholatCameraPopup.postMessage({ type: 'SHOLAT_SCAN_DUPLICATE', nama: siswa.nama }, '*'); } catch(e) {}
            }
            return;
        }

        const tanggal  = document.getElementById('sholatTanggal').value;
        const waktu    = document.getElementById('sholatWaktu').value;
        const kelasSel = document.getElementById('sholatKelas').value;

        if (typeof dhPlayBeep === 'function') dhPlayBeep('success'); // Bunyi langsung saat scan valid — tidak menunggu server
        tampilkanNotif('bg-orange-50 text-orange-600 border border-orange-100', '⏳ Menyimpan ' + siswa.nama + '...');

        // Jam ASLI saat scan tervalidasi (lihat penjelasan formatJamAksi)
        const jamAksiSholat = formatJamAksi();

        queueOfflineAction('Presensi Sholat', 'submitPresensiSholat', [
                [{ nis: siswa.nis, nama: siswa.nama, kelas: siswa.kelas || kelasSel, status: 'Hadir', keterangan: sholatKetMap[nis] || '', jamAksi: jamAksiSholat }],
                tanggal, waktu, buildInputOleh()
            ], `${siswa.nama} — ${waktu}`, 'direct-first')
            .then(outcome => {
                if (outcome.viaServer) {
                    const res = outcome.result;
                    if (res && res.success) {
                        sholatLockedMap[nis] = { status: 'Hadir', keterangan: sholatKetMap[nis] || '', jamAbsen: jamAksiSholat };
                        delete sholatStatusMap[nis];
                        renderSholatTable(kelasSel === 'SEMUA');
                        tampilkanNotif('bg-emerald-50 text-emerald-700 border border-emerald-100', '✅ ' + siswa.nama + ' — Hadir (tersimpan & terkunci)');
                        const banner = document.getElementById('sholatSubmittedBanner');
                        if (banner) banner.classList.remove('hidden');
                        if (sholatCameraPopup && !sholatCameraPopup.closed) {
                            try { sholatCameraPopup.postMessage({ type: 'SHOLAT_SCAN_SUCCESS', nama: siswa.nama, status: 'Ibadah' }, '*'); } catch(e) {}
                        }
                    } else {
                        if (typeof dhPlayBeep === 'function') dhPlayBeep('error');
                        tampilkanNotif('bg-red-50 text-red-600 border border-red-100', '❌ ' + ((res && res.message) || 'Gagal menyimpan'));
                        if (sholatCameraPopup && !sholatCameraPopup.closed) {
                            try { sholatCameraPopup.postMessage({ type: 'SHOLAT_SCAN_ERROR', message: (res && res.message) || 'Gagal menyimpan' }, '*'); } catch(e) {}
                        }
                    }
                } else {
                    // Offline / server gak terjangkau -> kunci sementara di perangkat biar gak discan dobel,
                    // beneran tersimpan di server setelah sinkron
                    sholatLockedMap[nis] = { status: 'Hadir', keterangan: sholatKetMap[nis] || '', jamAbsen: jamAksiSholat };
                    delete sholatStatusMap[nis];
                    renderSholatTable(kelasSel === 'SEMUA');
                    tampilkanNotif('bg-amber-50 text-amber-600 border border-amber-100', '📥 ' + siswa.nama + ' tersimpan di perangkat (menunggu Sinkron)');
                    const banner = document.getElementById('sholatSubmittedBanner');
                    if (banner) banner.classList.remove('hidden');
                    if (sholatCameraPopup && !sholatCameraPopup.closed) {
                        try { sholatCameraPopup.postMessage({ type: 'SHOLAT_SCAN_SUCCESS', nama: siswa.nama, status: 'Ibadah' }, '*'); } catch(e) {}
                    }
                }
            });

        const row = document.getElementById('sholat-row-' + nis);
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function sholatSubmitManual() {
        const inp = document.getElementById('sholatManualNis');
        if (!inp) return;
        const val = inp.value.trim();
        if (!val) { showAlert('error', 'Masukkan No. Kartu terlebih dahulu.'); return; }
        inp.value = '';
        sholatOnScanResult(val);
    }

    function buildInputOleh() {
      const role  = (currentUser.role || "").toLowerCase();
      const name  = (currentUser.identifier || "").trim();
      if (role === "admin")  return "Input Admin";
      if (role === "waka")  return "Input Waka";
      if (role === "guru")   return "Input Guru " + name;
      return "Input " + name;
    }

    function submitPresensiSholatFront() {
      const tanggal = document.getElementById('sholatTanggal').value;
      const waktu   = document.getElementById('sholatWaktu').value;
      const kelas   = document.getElementById('sholatKelas').value;

      if (!tanggal || !waktu || !kelas || !sholatStudents.length) {
        Swal.fire('Perhatian', 'Lengkapi filter terlebih dahulu.', 'warning'); return;
      }
      const terisi = sholatStudents.filter(s => sholatStatusMap[s.nis] && !sholatLockedMap[s.nis]);
      if (terisi.length === 0) {
        Swal.fire('Perhatian', 'Belum ada siswa yang ditandai statusnya.', 'warning'); return;
      }

      const jamAksiBatchSholat = formatJamAksi();
      const dataList = sholatStudents
        .filter(s => sholatStatusMap[s.nis] && !sholatLockedMap[s.nis])
        .map(s => ({
          nis       : s.nis,
          nama       : s.nama,
          kelas      : s.kelas || kelas,
          status     : sholatStatusMap[s.nis],
          keterangan : sholatKetMap[s.nis] || '',
          jamAksi    : jamAksiBatchSholat
        }));

      showLoading();
      queueOfflineAction('Presensi Sholat (Batch)', 'submitPresensiSholat', [dataList, tanggal, waktu, buildInputOleh()], `${dataList.length} siswa — ${waktu}`, true)
        .then(outcome => {
          hideLoading();
          if (outcome.viaServer) {
            const res = outcome.result;
            if (res.success) {
              Swal.fire({ icon:'success', title:'Tersimpan!', text: res.message, timer: 2000, showConfirmButton: false });
              document.getElementById('sholatSubmittedBanner').classList.remove('hidden');
              onSholatFilterChange(); // refresh dari server -> siswa yang baru disimpan otomatis terkunci
            } else {
              Swal.fire('Gagal', res.message, 'error');
            }
          } else {
            // Offline -> kunci sementara di perangkat (belum sinkron, belum benar-benar di server)
            dataList.forEach(d => {
              sholatLockedMap[d.nis] = { status: d.status, keterangan: d.keterangan, jamAbsen: jamAksiBatchSholat };
              delete sholatStatusMap[d.nis];
            });
            renderSholatTable(kelas === 'SEMUA');
            document.getElementById('sholatSubmittedBanner').classList.remove('hidden');
            Swal.fire({ icon:'info', title:'Tersimpan di Perangkat', text: `${dataList.length} data disimpan di perangkat. Kirim lewat menu "Sinkron Data".`, timer: 2500, showConfirmButton: false });
          }
        });
    }

    // ── REKAP ──
    // ---- Rekap Presensi Sholat ----
    let sholatRekapReqSeq = 0;        // penanda request terbaru (respons lama diabaikan)
    let sholatRekapView = [];         // data yang sedang tampil (setelah filter status)
    let sholatRekapShown = 0;         // jumlah baris yang sudah digambar
    let sholatRekapStatusBound = false;
    let sholatRekapFilterTerakhir = { bulan: '', kelas: '', waktu: '' }; // filter dari data yang sedang tampil
    let sholatRekapExporting = false;
    const SHOLAT_REKAP_CHUNK = 300;   // gambar bertahap supaya browser tidak macet di data ribuan baris

    function sholatRekapPesan(html) {
      document.getElementById('sholatRekapTbody').innerHTML =
        `<tr><td colspan="9" class="py-8 text-center">${html}</td></tr>`;
    }
    function sholatRekapPesanError(msg) {
      sholatRekapPesan(`<span class="text-red-400">${msg}</span><br>
        <button onclick="loadRekapSholatData()" class="mt-2 text-xs underline text-emerald-600">Coba lagi</button>`);
    }

    function sholatRekapRowHtml(d, i) {
      const waktuIcon = { Dzuhur:'☀️' };
      let badge, rowClass = '';
      if (d.status === 'Hadir') {
        badge    = `<span class="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">✓ Hadir</span>`;
        rowClass = 'bg-emerald-50/30';
      } else if (d.status === 'Izin / Uzur') {
        badge    = `<span class="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full">⚬ Izin</span>`;
      } else if (d.status === 'Belum Absen') {
        badge    = `<span class="bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full">⏳ Belum Absen</span>`;
        rowClass = 'bg-amber-50/40';
      } else {
        badge    = `<span class="bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded-full">✗ Tidak Hadir</span>`;
        rowClass = 'bg-red-50/20';
      }
      return `
      <tr class="border-b border-gray-100 hover:brightness-95 transition ${rowClass}">
        <td class="px-3 py-2.5 text-gray-400 text-[10px]">${i+1}</td>
        <td class="px-3 py-2.5 text-xs text-gray-600">${d.tanggal}</td>
        <td class="px-3 py-2.5 text-xs text-gray-500">${d.nis}</td>
        <td class="px-3 py-2.5 text-xs font-medium text-gray-800">${d.nama}</td>
        <td class="px-3 py-2.5 text-xs text-gray-600">${d.kelas}</td>
        <td class="px-3 py-2.5 text-xs">${(waktuIcon[d.waktuSholat]||'')} ${d.waktuSholat}</td>
        <td class="px-3 py-2.5 text-center">${badge}</td>
        <td class="px-3 py-2.5 text-center text-xs font-mono text-gray-600">${d.jamAbsen && d.jamAbsen !== '-' ? d.jamAbsen : '-'}</td>
        <td class="px-3 py-2.5 text-xs text-gray-400">${d.keterangan||'-'}</td>
      </tr>`;
    }

    // Gambar sebagian baris berikutnya (maks SHOLAT_REKAP_CHUNK per kali)
    function sholatRekapRenderNext() {
      const tbody = document.getElementById('sholatRekapTbody');
      const more = document.getElementById('sholatRekapMoreRow');
      if (more) more.remove();
      const end = Math.min(sholatRekapShown + SHOLAT_REKAP_CHUNK, sholatRekapView.length);
      let html = '';
      for (let i = sholatRekapShown; i < end; i++) html += sholatRekapRowHtml(sholatRekapView[i], i);
      sholatRekapShown = end;
      if (end < sholatRekapView.length) {
        const sisa = sholatRekapView.length - end;
        html += `<tr id="sholatRekapMoreRow"><td colspan="9" class="py-4 text-center">
          <button onclick="sholatRekapRenderNext()" class="text-xs font-bold text-emerald-600 underline">Tampilkan ${Math.min(SHOLAT_REKAP_CHUNK, sisa)} baris lagi (sisa ${sisa})</button>
        </td></tr>`;
      }
      tbody.insertAdjacentHTML('beforeend', html);
    }

    // Terapkan filter status pada data yang SUDAH dimuat -- tanpa tanya server lagi
    function sholatRekapTampilkanTabel() {
      const status = document.getElementById('sholatRekapStatus').value;
      const tbody = document.getElementById('sholatRekapTbody');
      sholatRekapView = status ? sholatRekapData.filter(d => d.status === status) : sholatRekapData;
      sholatRekapShown = 0;
      if (!sholatRekapView.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="py-12 text-center text-gray-400">${status ? 'Tidak ada siswa dengan status "' + status + '" pada filter ini.' : 'Tidak ada data pada periode ini.'}</td></tr>`;
        return;
      }
      tbody.innerHTML = '';
      sholatRekapRenderNext();
    }

    function loadRekapSholatData() {
      const bulan   = document.getElementById('sholatRekapBulan').value;
      const kelas   = document.getElementById('sholatRekapKelas').value;
      const waktu   = document.getElementById('sholatRekapWaktu').value;

      // Ganti filter status = cukup saring ulang data di layar (instan), tidak perlu ke server
      if (!sholatRekapStatusBound) {
        sholatRekapStatusBound = true;
        document.getElementById('sholatRekapStatus').addEventListener('change', () => {
          if (sholatRekapData.length) sholatRekapTampilkanTabel();
        });
      }

      const seq = ++sholatRekapReqSeq;
      sholatRekapPesan(`<div class="inline-block w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-xs text-gray-400 mt-2">Memuat rekap sholat...</p>`);

      // Kalau server tidak membalas, jangan biarkan layar loading selamanya
      const slowTimer = setTimeout(() => {
        if (seq !== sholatRekapReqSeq) return;
        sholatRekapPesanError('Server lambat merespons. Coba persempit filter (pilih kelas) atau ulangi.');
      }, 60000);

      // Kirim filterWaktu ke backend sekalian — filter kelas wajib untuk tampilkan "Belum Absen"
      gas.run
        .withSuccessHandler(res => {
          clearTimeout(slowTimer);
          if (seq !== sholatRekapReqSeq) return;   // sudah kesusul permintaan yang lebih baru
          try {
            if (!res) { sholatRekapPesanError('Server tidak mengembalikan data. Coba lagi.'); return; }
            if (!res.success) { sholatRekapPesanError(res.message || 'Gagal memuat rekap.'); return; }
            const allData = res.data || [];
            sholatRekapData = allData;
            sholatRekapFilterTerakhir = { bulan: bulan || '', kelas: kelas || '', waktu: waktu || '' };

            // Stat cards dihitung dari SEMUA data (sebelum filter status)
            const hadir  = allData.filter(d => d.status === 'Hadir').length;
            const tidak  = allData.filter(d => d.status === 'Tidak Hadir').length;
            const belum  = allData.filter(d => d.status === 'Belum Absen').length;
            const total  = allData.length;
            const persen = total > 0 ? Math.round(hadir / total * 100) : 0;
            document.getElementById('sholatStatTotal').textContent  = total;
            document.getElementById('sholatStatHadir').textContent  = hadir;
            document.getElementById('sholatStatTidak').textContent  = tidak + (belum > 0 ? ` | ⏳ ${belum} belum` : '');
            document.getElementById('sholatStatPersen').textContent = persen + '%';

            sholatRekapTampilkanTabel();
          } catch (jsErr) {
            // Error JS di handler TIDAK ditangkap withFailureHandler -> tanpa ini layar nyangkut di spinner
            console.error('rekap sholat render error:', jsErr);
            sholatRekapPesanError('Error menampilkan data: ' + (jsErr.message || jsErr));
          }
        })
        .withFailureHandler(err => {
          clearTimeout(slowTimer);
          if (seq !== sholatRekapReqSeq) return;
          sholatRekapPesanError('Gagal: ' + err);
        })
        .getRekapSholat(kelas || null, bulan || null, waktu || null);
    }

    // Unduh Excel 2 sheet: (1) daftar rekap, (2) matriks bulanan ke kanan per tanggal.
    // Dibuat di server (Google Sheets) supaya warna & format sama dengan rekap presensi masuk.
    function exportRekapSholatExcel() {
      if (!sholatRekapData.length) { Swal.fire('Info','Tidak ada data untuk diekspor.','info'); return; }
      if (sholatRekapExporting) return;
      sholatRekapExporting = true;

      Swal.fire({ title: 'Membuat file Excel...', text: 'Mohon tunggu, sedang menyusun rekap dan matriks bulanan.',
                  allowOutsideClick: false, allowEscapeKey: false, didOpen: () => Swal.showLoading() });

      gas.run
        .withSuccessHandler(res => {
          sholatRekapExporting = false;
          Swal.close();
          if (res && res.success && res.url) {
            window.open(res.url, '_blank');
          } else {
            Swal.fire('Gagal', (res && res.message) || 'Gagal membuat file Excel.', 'error');
          }
        })
        .withFailureHandler(err => {
          sholatRekapExporting = false;
          Swal.close();
          Swal.fire('Error', 'Gagal: ' + err, 'error');
        })
        .generateExcelRekapSholat(currentUser.token, sholatRekapFilterTerakhir);
    }

    checkSession();
