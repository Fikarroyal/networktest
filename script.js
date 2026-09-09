(function () {
  'use strict';

  /* ------------------------------------------------------------------
     0. STATE & SETTINGS
     ------------------------------------------------------------------ */
  const STORAGE_HISTORY = 'networkTestHistory';

  // Pengaturan tampilan pakai default tetap (fitur toggle UI-nya sudah dihapus).
  const settings = { animation: true, quality: 'medium', sound: false, autoInterval: 0 };

  const state = {
    running: false,
    mode: 'auto',            // 'auto' | 'manual'
    stageBusy: false,         // true selama animasi satu tahap masih berjalan
    stageIndex: -1,           // -1 = belum mulai
    stages: ['connect', 'ping', 'download', 'upload', 'finish'],
    ipInfo: null,
    userCoords: null,
    selectedServer: null,
    lastResult: null,
    autoTimer: null,
    usedFallback: false      // true jika pengukuran asli gagal & terpaksa pakai simulasi
  };

  const SERVER_CITIES = [
    { id: 'jkt', name: 'Jakarta', lat: -6.2088, lng: 106.8456 },
    { id: 'bdg', name: 'Bandung', lat: -6.9175, lng: 107.6191 },
    { id: 'sby', name: 'Surabaya', lat: -7.2575, lng: 112.7521 },
    { id: 'smg', name: 'Semarang', lat: -6.9932, lng: 110.4203 },
    { id: 'yog', name: 'Yogyakarta', lat: -7.7956, lng: 110.3695 },
    { id: 'mdn', name: 'Medan', lat: 3.5952, lng: 98.6722 },
    { id: 'mks', name: 'Makassar', lat: -5.1477, lng: 119.4327 },
    { id: 'dps', name: 'Denpasar', lat: -8.6705, lng: 115.2126 }
  ];
  let SERVERS = [];

  document.addEventListener('DOMContentLoaded', init);

  function safeRun(label, fn) {
    try { fn(); }
    catch (err) {
      console.error('Network Test — gagal inisialisasi bagian "' + label + '":', err);
    }
  }

  function init() {
    safeRun('icons', refreshIcons);
    safeRun('navbar', initNavbar);
    safeRun('scrollReveal', initScrollReveal);
    safeRun('heroCanvas', initHeroCanvas);
    safeRun('ripple', initRipple);
    safeRun('applySettings', applySettings);
    safeRun('serverList', renderServerList);
    safeRun('autoServerBtn', () => {
      document.getElementById('autoServerBtn').addEventListener('click', autoSelectBestServer);
    });
    safeRun('dial', initDial);
    safeRun('realtimeChart', initRealtimeChart);
    safeRun('export', initExport);
    safeRun('history', initHistory);
    safeRun('ipInfo', fetchIpInfo);
    safeRun('networkStatus', initNetworkStatusWatcher);
    safeRun('autoInterval', scheduleAutoInterval);

    // Jaring pengaman terakhir: pastikan seluruh konten reveal tetap
    // tampil meskipun ada error tak terduga yang belum tertangani.
    window.addEventListener('error', () => {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('is-visible'));
    });
  }

  /* ------------------------------------------------------------------
     1. NAVBAR — scroll state, active link, mobile menu
     ------------------------------------------------------------------ */
  function initNavbar() {
    const navbar = document.getElementById('navbar');
    const burger = document.getElementById('burgerBtn');
    const mobile = document.getElementById('navbarMobile');

    window.addEventListener('scroll', () => {
      navbar.classList.toggle('is-scrolled', window.scrollY > 24);
    }, { passive: true });

    burger.addEventListener('click', () => {
      burger.classList.toggle('is-active');
      mobile.classList.toggle('is-open');
    });

    document.querySelectorAll('[data-nav-mobile]').forEach(link => {
      link.addEventListener('click', () => {
        burger.classList.remove('is-active');
        mobile.classList.remove('is-open');
      });
    });

    // Active nav indicator berdasarkan section yang terlihat
    const navLinks = document.querySelectorAll('[data-nav]');
    const sections = Array.from(navLinks).map(l => document.querySelector(l.getAttribute('href'))).filter(Boolean);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = '#' + entry.target.id;
          navLinks.forEach(l => l.classList.toggle('is-active', l.getAttribute('href') === id));
        }
      });
    }, { rootMargin: '-40% 0px -50% 0px', threshold: 0 });

    sections.forEach(sec => observer.observe(sec));
  }

  /* ------------------------------------------------------------------
     2. SCROLL REVEAL
     ------------------------------------------------------------------ */
  function initScrollReveal() {
    if (!('IntersectionObserver' in window)) return; // tanpa dukungan browser, konten tetap tampil apa adanya
    const items = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach(el => {
      el.classList.add('reveal-armed');
      io.observe(el);
    });
  }

  /* ------------------------------------------------------------------
     3. RIPPLE EFFECT PADA TOMBOL
     ------------------------------------------------------------------ */
  function initRipple() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn, .dial-btn, .server-item');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      // Hanya set position:relative jika elemen memang belum punya posisi
      // (mis. dial-btn sudah position:absolute lewat CSS — jangan ditimpa,
      // atau lingkaran tombol akan kolaps dari posisinya semula).
      if (window.getComputedStyle(btn).position === 'static') {
        btn.style.position = 'relative';
      }
      btn.style.overflow = 'hidden';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 620);
    });
  }

  /* ------------------------------------------------------------------
     4. HERO — Visualisasi Jaringan 3D Abstrak (Canvas)
     ------------------------------------------------------------------ */
  function initHeroCanvas() {
    const canvas = document.getElementById('heroCanvas');
    const ctx = canvas.getContext('2d');
    const hero = canvas.closest('.hero');
    let w, h, dpr;
    let nodes = [];
    let particles = [];
    let mouse = { x: 0, y: 0, active: false };
    let rafId;

    function countByQuality() {
      const isMobile = window.innerWidth < 768;
      if (settings.quality === 'low' || isMobile) return { nodes: 22, particles: 14 };
      if (settings.quality === 'high') return { nodes: 55, particles: 40 };
      return { nodes: 38, particles: 26 };
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth = hero.clientWidth;
      h = canvas.clientHeight = hero.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    }

    function buildNodes() {
      const { nodes: n, particles: p } = countByQuality();
      nodes = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random(),
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18
      }));
      particles = Array.from({ length: p }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4,
        vy: -(Math.random() * 0.25 + 0.08)
      }));
    }

    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      mouse.x = (e.clientX - rect.left - w / 2) / w;
      mouse.y = (e.clientY - rect.top - h / 2) / h;
      mouse.active = true;
    });
    hero.addEventListener('mouseleave', () => { mouse.active = false; });

    function draw() {
      if (!settings.animation) { ctx.clearRect(0, 0, w, h); return; }
      ctx.clearRect(0, 0, w, h);

      const px = mouse.active ? mouse.x * 18 : 0;
      const py = mouse.active ? mouse.y * 18 : 0;

      // Update posisi node (drift lambat + wireframe rotation halus)
      nodes.forEach(node => {
        node.x += node.vx;
        node.y += node.vy;
        if (node.x < 0 || node.x > w) node.vx *= -1;
        if (node.y < 0 || node.y > h) node.vy *= -1;
      });

      // Garis penghubung antar node terdekat
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = 130;
          if (dist < maxDist) {
            const opacity = (1 - dist / maxDist) * 0.28 * (0.4 + a.z);
            ctx.strokeStyle = `rgba(47,127,255,${opacity})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x + px * a.z, a.y + py * a.z);
            ctx.lineTo(b.x + px * b.z, b.y + py * b.z);
            ctx.stroke();
          }
        }
      }

      // Node bercahaya
      nodes.forEach(node => {
        const nx = node.x + px * node.z;
        const ny = node.y + py * node.z;
        const radius = 1.4 + node.z * 2.2;
        const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, radius * 5);
        grad.addColorStop(0, `rgba(47,127,255,${0.55 * node.z + 0.15})`);
        grad.addColorStop(1, 'rgba(47,127,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(nx, ny, radius * 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(20,74,158,${0.55 + node.z * 0.4})`;
        ctx.beginPath();
        ctx.arc(nx, ny, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Partikel kecil naik perlahan
      particles.forEach(p => {
        p.y += p.vy;
        if (p.y < -10) p.y = h + 10;
        ctx.fillStyle = 'rgba(79,158,234,0.35)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });

      rafId = requestAnimationFrame(draw);
    }

    function start() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(draw); }

    window.addEventListener('resize', debounce(resize, 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(rafId);
      else start();
    });

    resize();
    start();

    // expose supaya bisa direfresh saat kualitas animasi berubah di pengaturan
    window.__heroCanvasRebuild = buildNodes;
  }

  /* ------------------------------------------------------------------
     6. PEMILIHAN SERVER (Indonesia) — jarak nyata via koordinat lokasi
     ------------------------------------------------------------------ */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function buildServers() {
    return SERVER_CITIES.map(city => {
      let distanceKm = null;
      if (state.userCoords) {
        distanceKm = Math.round(haversineKm(state.userCoords.lat, state.userCoords.lng, city.lat, city.lng));
      }
      // Angka ping di daftar server ini hanya perkiraan awal berbasis jarak
      // (dipakai untuk urutan rekomendasi) — ping SEBENARNYA yang dipakai
      // pada hasil akhir selalu diambil dari pengukuran nyata saat tombol
      // MULAI ditekan, bukan dari angka perkiraan ini.
      const basePing = 5 + Math.random() * 4;
      const distanceFactor = distanceKm !== null ? distanceKm / 45 : 10 + Math.random() * 35;
      const ping = Math.max(4, Math.round(basePing + distanceFactor + (Math.random() * 4 - 2)));
      return { ...city, distanceKm, ping };
    });
  }

  function renderServerList(preserveSelection) {
    const previousId = preserveSelection && state.selectedServer ? state.selectedServer.id : null;
    SERVERS = buildServers();

    const list = document.getElementById('serverList');
    list.innerHTML = '';
    SERVERS.forEach(server => {
      const el = document.createElement('button');
      el.className = 'server-item';
      el.type = 'button';
      el.dataset.id = server.id;
      const distanceLabel = server.distanceKm !== null
        ? `${server.distanceKm.toLocaleString('id-ID')} km dari lokasi Anda`
        : 'Server domestik Indonesia';
      el.innerHTML = `
        <span class="server-item__icon"><i data-lucide="server"></i></span>
        <span class="server-item__name">${server.name}, Indonesia</span>
        <span class="server-item__meta">${distanceLabel}</span>
        <span class="server-item__ping">${server.ping} ms</span>
      `;
      el.addEventListener('click', () => selectServer(server.id));
      list.appendChild(el);
    });
    refreshIcons();

    if (previousId && SERVERS.some(s => s.id === previousId)) {
      selectServer(previousId, true);
    } else {
      const best = SERVERS.reduce((a, b) => (a.ping < b.ping ? a : b));
      selectServer(best.id, true);
    }
  }

  function autoSelectBestServer() {
    const best = SERVERS.reduce((a, b) => (a.ping < b.ping ? a : b));
    selectServer(best.id);
    showToast('info', `Server otomatis dipilih: ${best.name} (${best.ping} ms)`, 'sparkles');
  }

  function selectServer(id, silent) {
    state.selectedServer = SERVERS.find(s => s.id === id);
    if (!state.selectedServer) return;
    document.querySelectorAll('.server-item').forEach(el => {
      el.classList.toggle('is-selected', el.dataset.id === id);
    });
    document.getElementById('resultServer').textContent = `${state.selectedServer.name}, Indonesia`;
  }

  /* ------------------------------------------------------------------
     7. IP / ISP / LOKASI — via API publik (fallback jika gagal)
     ------------------------------------------------------------------ */
  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  function getBrowserCoords() {
    // Lokasi dari IP hanya menunjuk titik registrasi blok IP milik ISP —
    // untuk provider tertentu ini bisa di kota lain yang cukup jauh dari
    // lokasi fisik pengguna sebenarnya. Geolocation API browser (GPS/WiFi)
    // jauh lebih akurat, jadi diprioritaskan bila pengguna mengizinkannya.
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null), // ditolak pengguna / tidak tersedia — pakai fallback IP
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 }
      );
    });
  }

  async function fetchIpInfo() {
    // Beberapa penyedia lokasi IP dicoba berurutan — kalau satu gagal/diblokir
    // jaringan pengguna, otomatis pindah ke penyedia berikutnya. Ini penting
    // karena situs ini bisa diakses dari perangkat & jaringan mana saja.
    const providers = [
      {
        url: 'https://ipapi.co/json/',
        parse: (d) => ({
          ip: d.ip, isp: d.org || d.asn,
          city: d.city, region: d.region, country: d.country_name,
          lat: d.latitude, lng: d.longitude
        })
      },
      {
        url: 'https://ipwho.is/',
        parse: (d) => {
          if (d.success === false) throw new Error('ipwho.is menolak permintaan');
          return {
            ip: d.ip, isp: d.connection && (d.connection.isp || d.connection.org),
            city: d.city, region: d.region, country: d.country,
            lat: d.latitude, lng: d.longitude
          };
        }
      },
      {
        url: 'https://get.geojs.io/v1/ip/geo.json',
        parse: (d) => ({
          ip: d.ip, isp: d.organization_name || d.organization,
          city: d.city, region: d.region, country: d.country,
          lat: d.latitude ? parseFloat(d.latitude) : null,
          lng: d.longitude ? parseFloat(d.longitude) : null
        })
      },
      {
        // Cadangan terakhir — data ISP (field "org") dari ipinfo.io biasanya
        // sangat akurat, dipakai bila tiga penyedia di atas semuanya gagal.
        url: 'https://ipinfo.io/json',
        parse: (d) => {
          const [lat, lng] = (d.loc || '').split(',').map(Number);
          const countryNames = { ID: 'Indonesia' };
          return {
            ip: d.ip,
            isp: d.org ? d.org.replace(/^AS\d+\s*/, '') : null,
            city: d.city, region: d.region, country: countryNames[d.country] || d.country,
            lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null
          };
        }
      }
    ];

    // Jalankan permintaan izin lokasi browser bersamaan dengan pengecekan IP,
    // supaya tidak saling menunggu dan proses tetap cepat.
    const browserCoordsPromise = getBrowserCoords();

    let result = null;
    for (const provider of providers) {
      try {
        const res = await fetchWithTimeout(provider.url, 5000);
        if (!res.ok) throw new Error('Respons tidak OK: ' + res.status);
        const data = await res.json();
        const parsed = provider.parse(data);
        if (!parsed.ip) throw new Error('Data IP kosong');
        result = parsed;
        break;
      } catch (err) {
        console.error('Network Test — penyedia lokasi gagal (' + provider.url + '):', err);
      }
    }

    if (result) {
      state.ipInfo = {
        ip: result.ip || '—',
        isp: result.isp || 'Tidak diketahui',
        location: [result.city, result.region, result.country].filter(Boolean).join(', ') || 'Tidak diketahui'
      };

      // Prioritaskan koordinat GPS/WiFi dari browser (jauh lebih akurat);
      // pakai koordinat dari penyedia IP hanya bila izin lokasi tidak diberikan.
      const browserCoords = await browserCoordsPromise;
      const coords = browserCoords || (
        typeof result.lat === 'number' && typeof result.lng === 'number' && Number.isFinite(result.lat) && Number.isFinite(result.lng)
          ? { lat: result.lat, lng: result.lng }
          : null
      );

      // Perhalus lokasi sampai level kelurahan/kabupaten/kota lewat reverse
      // geocoding (OpenStreetMap Nominatim) memakai koordinat di atas.
      if (coords) {
        state.userCoords = coords;
        try {
          const geoUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.lat}&lon=${coords.lng}&zoom=16&addressdetails=1&accept-language=id`;
          const geoRes = await fetchWithTimeout(geoUrl, 5000);
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            const addr = geoData.address || {};
            const parts = [
              addr.village || addr.suburb || addr.city_district || addr.town || addr.city,
              addr.county || addr.city || addr.regency,
              addr.state,
              addr.country
            ].filter(Boolean);
            const uniqueParts = parts.filter((part, idx) => parts.indexOf(part) === idx);
            if (uniqueParts.length) {
              state.ipInfo.location = uniqueParts.slice(0, 3).join(', ');
            }
          }
        } catch (err) {
          console.error('Network Test — reverse geocode lokasi gagal:', err);
          // Biarkan lokasi dari penyedia IP tetap dipakai sebagai fallback.
        }
        // Perbarui jarak & ping perkiraan tiap server dengan koordinat asli,
        // sambil mempertahankan server yang mungkin sudah dipilih pengguna.
        renderServerList(true);
      }
    } else {
      state.ipInfo = { ip: 'Tidak terdeteksi', isp: 'Tidak terdeteksi', location: 'Tidak terdeteksi' };
    }

    document.getElementById('resultIP').textContent = state.ipInfo.ip;
    document.getElementById('resultISP').textContent = state.ipInfo.isp;
    document.getElementById('resultLocation').textContent = state.ipInfo.location;
  }

  /* ------------------------------------------------------------------
     8. STATUS JARINGAN (Terhubung / Tidak Terhubung)
     ------------------------------------------------------------------ */
  function initNetworkStatusWatcher() {
    window.addEventListener('online', () => setNetworkStatus('connected'));
    window.addEventListener('offline', () => setNetworkStatus('offline'));
    setNetworkStatus(navigator.onLine ? 'connected' : 'offline');
  }

  function setNetworkStatus(kind) {
    const pill = document.getElementById('networkStatusPill');
    const text = document.getElementById('networkStatusText');
    pill.classList.remove('is-testing', 'is-unstable', 'is-offline');
    const map = {
      connected: 'Terhubung',
      testing: 'Sedang Menguji',
      stable: 'Koneksi Stabil',
      unstable: 'Koneksi Tidak Stabil',
      offline: 'Tidak Terhubung'
    };
    if (kind === 'testing') pill.classList.add('is-testing');
    if (kind === 'unstable') pill.classList.add('is-unstable');
    if (kind === 'offline') pill.classList.add('is-offline');
    text.textContent = map[kind] || map.connected;
  }

  /* ------------------------------------------------------------------
     9. GRAFIK REAL-TIME (Chart.js)
     ------------------------------------------------------------------ */
  let realtimeChart;
  function initRealtimeChart() {
    const ctx = document.getElementById('realtimeChart').getContext('2d');
    realtimeChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Download (Mbps)', data: [], borderColor: '#2f7fff', backgroundColor: 'rgba(47,127,255,0.12)', tension: 0.35, fill: true, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
          { label: 'Upload (Mbps)', data: [], borderColor: '#5fb8ab', backgroundColor: 'rgba(95,184,171,0.1)', tension: 0.35, fill: true, pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
          { label: 'Ping (ms)', data: [], borderColor: '#f2b84b', backgroundColor: 'rgba(242,184,75,0.08)', tension: 0.35, fill: false, pointRadius: 0, borderWidth: 1.6, borderDash: [4, 3], yAxisID: 'y1' }
        ]
      },
      options: {
        responsive: true,
        animation: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false } },
        scales: {
          x: { display: false },
          y: { position: 'left', grid: { color: 'rgba(47,127,255,0.08)' }, ticks: { color: '#5b7591', font: { family: 'Roboto Mono', size: 10 } } },
          y1: { position: 'right', grid: { display: false }, ticks: { color: '#5b7591', font: { family: 'Roboto Mono', size: 10 } } }
        }
      }
    });
  }

  function pushChartPoint(download, upload, ping) {
    if (!realtimeChart) return;
    const d = realtimeChart.data;
    d.labels.push('');
    d.datasets[0].data.push(download);
    d.datasets[1].data.push(upload);
    d.datasets[2].data.push(ping);
    const MAX_POINTS = 24;
    if (d.labels.length > MAX_POINTS) {
      d.labels.shift();
      d.datasets.forEach(ds => ds.data.shift());
    }
    realtimeChart.update('none');
  }

  function resetChart() {
    if (!realtimeChart) return;
    realtimeChart.data.labels = [];
    realtimeChart.data.datasets.forEach(ds => (ds.data = []));
    realtimeChart.update('none');
  }

  /* ------------------------------------------------------------------
     10. MESIN PENGUJIAN JARINGAN NYATA
     Ping/jitter/packet-loss/download/upload diukur langsung dari koneksi
     internet pengguna memakai infrastruktur publik speed.cloudflare.com
     (endpoint yang memang disediakan Cloudflare untuk uji kecepatan pihak
     ketiga). Kalau koneksi ke server pengujian gagal/diblokir jaringan,
     otomatis jatuh ke estimasi simulasi yang konsisten secara internal
     supaya hasil tetap tampil, dan pengguna diberi tahu lewat notifikasi.
     ------------------------------------------------------------------ */
  const CF_DOWNLOAD_URL = 'https://speed.cloudflare.com/__down';
  const CF_UPLOAD_URL = 'https://speed.cloudflare.com/__up';

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  async function measurePing(sampleCount, onSample) {
    const samples = [];
    let failed = 0;
    for (let i = 0; i < sampleCount; i++) {
      if (!state.running) break;
      const t0 = performance.now();
      try {
        await fetchWithTimeout(`${CF_DOWNLOAD_URL}?bytes=0&x=${Math.random()}`, 3000);
        const rtt = performance.now() - t0;
        samples.push(rtt);
        if (onSample) onSample(rtt);
      } catch (err) {
        failed++;
      }
    }
    if (samples.length < 2) return null;
    // Buang sampel pertama (sering lebih lambat karena overhead koneksi awal)
    const usable = samples.length > 2 ? samples.slice(1) : samples;
    const avg = usable.reduce((a, b) => a + b, 0) / usable.length;
    const jitter = usable.reduce((a, b) => a + Math.abs(b - avg), 0) / usable.length;
    const packetLoss = (failed / sampleCount) * 100;
    return { ping: avg, jitter, packetLoss };
  }

  async function measureDownload(durationMs, onProgress) {
    const parallel = 4;
    const chunkBytes = 26214400; // 25 MB per permintaan
    let totalBytes = 0;
    let stopFlag = false;
    const start = performance.now();
    const activeControllers = [];

    const progressTimer = setInterval(() => {
      if (!state.running) { stopFlag = true; activeControllers.forEach(c => { try { c.abort(); } catch (e) {} }); return; }
      const elapsed = performance.now() - start;
      if (elapsed > 0) onProgress((totalBytes * 8) / (elapsed / 1000) / 1e6);
    }, 200);

    async function worker() {
      while (!stopFlag && state.running && performance.now() - start < durationMs) {
        const controller = new AbortController();
        activeControllers.push(controller);
        try {
          const res = await fetch(`${CF_DOWNLOAD_URL}?bytes=${chunkBytes}&x=${Math.random()}`, {
            signal: controller.signal, cache: 'no-store'
          });
          if (!res.ok) break;
          if (!res.body) { // browser tanpa dukungan streaming body — hitung sekaligus
            const buf = await res.arrayBuffer();
            totalBytes += buf.byteLength;
            continue;
          }
          const reader = res.body.getReader();
          while (true) {
            if (stopFlag || !state.running) { try { await reader.cancel(); } catch (e) {} break; }
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.length;
            if (performance.now() - start >= durationMs) {
              stopFlag = true;
              try { await reader.cancel(); } catch (e) {}
              break;
            }
          }
        } catch (err) {
          break; // satu worker gagal — worker lain tetap lanjut mengukur
        }
      }
    }

    const workers = Array.from({ length: parallel }, () => worker());
    await Promise.race([Promise.all(workers), sleep(durationMs + 2500)]);
    stopFlag = true;
    activeControllers.forEach(c => { try { c.abort(); } catch (e) {} });
    clearInterval(progressTimer);

    const elapsed = performance.now() - start;
    if (totalBytes <= 0 || elapsed <= 0) return null;
    return (totalBytes * 8) / (elapsed / 1000) / 1e6;
  }

  function measureUpload(durationMs, onProgress) {
    return new Promise((resolve) => {
      const parallel = 3;
      const blobSize = 10 * 1024 * 1024; // 10 MB per stream
      const payload = new Blob([new Uint8Array(blobSize)]);
      let totalLoaded = 0, settledCount = 0, finished = false;
      const start = performance.now();
      const xhrs = [];

      function finalize() {
        if (finished) return;
        finished = true;
        clearInterval(progressTimer);
        const elapsed = performance.now() - start;
        resolve(totalLoaded > 0 && elapsed > 0 ? (totalLoaded * 8) / (elapsed / 1000) / 1e6 : null);
      }

      const progressTimer = setInterval(() => {
        if (!state.running) { xhrs.forEach(x => { try { x.abort(); } catch (e) {} }); finalize(); return; }
        const elapsed = performance.now() - start;
        if (elapsed > 0) onProgress((totalLoaded * 8) / (elapsed / 1000) / 1e6);
      }, 200);

      for (let i = 0; i < parallel; i++) {
        const xhr = new XMLHttpRequest();
        xhrs.push(xhr);
        let lastLoaded = 0;
        xhr.open('POST', CF_UPLOAD_URL, true);
        xhr.upload.onprogress = (e) => { totalLoaded += Math.max(0, e.loaded - lastLoaded); lastLoaded = e.loaded; };
        const settle = () => { settledCount++; if (settledCount >= parallel) finalize(); };
        xhr.onloadend = settle;
        xhr.onerror = settle;
        xhr.timeout = durationMs + 6000;
        xhr.ontimeout = settle;
        try { xhr.send(payload); } catch (err) { settle(); }
      }

      setTimeout(() => {
        if (!finished) { xhrs.forEach(x => { try { x.abort(); } catch (e) {} }); finalize(); }
      }, durationMs + 1500);
    });
  }

  // ---------- Fallback simulasi (dipakai HANYA bila pengukuran asli gagal) ----------
  function applyFallback(part) {
    state.usedFallback = true;
    const Q = state.fallbackQ;
    if (part === 'ping') {
      const ping = round1(8 + (1 - Q) * 95 + (Math.random() * 6 - 3));
      state.profile.ping = Math.max(4, ping);
      state.profile.jitter = round1(Math.max(0.6, state.profile.ping * (0.05 + Math.random() * 0.22)));
      state.profile.packetLoss = Q > 0.78
        ? round1(Math.random() * 0.3)
        : round1(Math.min(6, Math.pow(1 - Q, 2) * 7 + Math.random() * 0.6));
    } else if (part === 'download') {
      state.profile.download = round1(Math.max(3, 14 + Q * 280 + (Math.random() * 18 - 9)));
    } else if (part === 'upload') {
      const ratio = Q > 0.85 ? (0.65 + Math.random() * 0.3) : (0.08 + Math.random() * 0.32);
      state.profile.upload = round1(Math.max(1, (state.profile.download || 50) * ratio));
    }
  }

  function computeScore({ ping, jitter, packetLoss, download, upload }) {
    const pingScore = clamp(100 - (ping - 8) * 1.1, 0, 100);
    const downloadScore = clamp((download / 250) * 100, 0, 100);
    const uploadScore = clamp((upload / 90) * 100, 0, 100);
    const jitterScore = clamp(100 - jitter * 3.4, 0, 100);
    const lossScore = clamp(100 - packetLoss * 18, 0, 100);
    const total = pingScore * 0.25 + downloadScore * 0.3 + uploadScore * 0.15 + jitterScore * 0.15 + lossScore * 0.15;
    return Math.round(clamp(total, 0, 100));
  }

  function gradePing(v) { return v < 20 ? 'sb' : v < 50 ? 'b' : v < 100 ? 'c' : 'k'; }
  function gradeJitter(v) { return v < 15 ? 'sb' : v < 30 ? 'b' : v < 50 ? 'c' : 'k'; }
  function gradeLoss(v) { return v < 0.5 ? 'sb' : v < 2 ? 'b' : v < 5 ? 'c' : 'k'; }
  function gradeDownload(v) { return v >= 100 ? 'sb' : v >= 25 ? 'b' : v >= 10 ? 'c' : 'k'; }
  function gradeUpload(v) { return v >= 20 ? 'sb' : v >= 10 ? 'b' : v >= 3 ? 'c' : 'k'; }
  function gradeScore(v) { return v >= 85 ? 'sb' : v >= 70 ? 'b' : v >= 50 ? 'c' : 'k'; }

  const gradeLabel = { sb: 'Sangat Baik', b: 'Baik', c: 'Cukup', k: 'Kurang' };
  const gradeTag = { sb: 'tag--good', b: 'tag--good', c: 'tag--fair', k: 'tag--poor' };

  /* ------------------------------------------------------------------
     11. DIAL & ALUR PENGUJIAN
     ------------------------------------------------------------------ */
  const STAGE_DURATIONS = { connect: 700, ping: 1800, download: 5000, upload: 4000, finish: 600 };
  const STAGE_WEIGHT = { connect: 0.05, ping: 0.15, download: 0.45, upload: 0.30, finish: 0.05 };

  function initDial() {
    document.getElementById('testButton').addEventListener('click', onDialClick);
    document.getElementById('modeAuto').addEventListener('click', () => setMode('auto'));
    document.getElementById('modeManual').addEventListener('click', () => setMode('manual'));
  }

  function setMode(mode) {
    if (state.running) return;
    state.mode = mode;
    document.getElementById('modeAuto').classList.toggle('is-active', mode === 'auto');
    document.getElementById('modeManual').classList.toggle('is-active', mode === 'manual');
  }

  function onDialClick() {
    if (state.running && state.mode === 'auto') { stopTest(true); return; }

    if (state.mode === 'auto') {
      startTest();
    } else {
      // Mode manual: setiap klik memajukan satu tahap
      if (!state.running) startTest();
      else if (!state.stageBusy) advanceManualStage();
    }
  }

  function startTest() {
    state.running = true;
    state.stageBusy = false;
    state.stageIndex = -1;
    state.profile = { ping: 0, jitter: 0, packetLoss: 0, download: 0, upload: 0 };
    state.fallbackQ = clamp(0.25 + Math.random() * 0.75, 0.25, 1);
    state.usedFallback = false;

    resetChart();
    resetStageUI();
    setNetworkStatus('testing');
    playBeep(660);
    showToast('info', 'Pengujian jaringan dimulai. Mohon tunggu sebentar…', 'plug-zap');

    const dialBtn = document.getElementById('testButton');
    dialBtn.classList.remove('is-redo');
    dialBtn.classList.add('is-testing');
    document.getElementById('dialLabel').classList.add('is-testing');
    document.getElementById('dialLabel').textContent = 'BERHENTI';
    document.getElementById('dialSub').textContent = state.mode === 'auto' ? 'Pengujian berjalan…' : 'Tekan untuk lanjut';

    runStage(0, state.mode === 'manual');
  }

  function advanceManualStage() {
    const next = state.stageIndex + 1;
    if (next >= state.stages.length) return;
    runStage(next, true);
  }

  async function runStage(index) {
    if (!state.running) return;
    if (index >= state.stages.length) { finishTest(); return; }
    state.stageIndex = index;
    const stageName = state.stages[index];
    setStageActive(stageName);
    state.stageBusy = true;

    const baseProgress = overallProgress(index - 1);
    const weight = STAGE_WEIGHT[stageName];
    const duration = STAGE_DURATIONS[stageName];
    const tickStart = performance.now();
    let ringDone = false;

    function ringTick() {
      if (!state.running || ringDone) return;
      const t = clamp((performance.now() - tickStart) / duration, 0, 0.96);
      updateDialProgress(baseProgress + weight * t);
      requestAnimationFrame(ringTick);
    }
    requestAnimationFrame(ringTick);

    try {
      if (stageName === 'connect') {
        await sleep(duration);
      } else if (stageName === 'ping') {
        const result = await measurePing(6, (rtt) => {
          document.getElementById('livePing').textContent = Math.max(0, Math.round(rtt));
        });
        if (result) {
          state.profile.ping = round1(result.ping);
          state.profile.jitter = round1(result.jitter);
          state.profile.packetLoss = round1(result.packetLoss);
        } else {
          applyFallback('ping');
        }
        document.getElementById('livePing').textContent = state.profile.ping.toFixed(0);
      } else if (stageName === 'download') {
        const mbps = await measureDownload(duration, (liveMbps) => {
          document.getElementById('liveDownload').textContent = liveMbps.toFixed(1);
          pushChartPoint(liveMbps, 0, state.profile.ping || 0);
        });
        state.profile.download = mbps && mbps > 0 ? round1(mbps) : (applyFallback('download'), state.profile.download);
        document.getElementById('liveDownload').textContent = state.profile.download.toFixed(1);
      } else if (stageName === 'upload') {
        const mbps = await measureUpload(duration, (liveMbps) => {
          document.getElementById('liveUpload').textContent = liveMbps.toFixed(1);
          pushChartPoint(state.profile.download || 0, liveMbps, state.profile.ping || 0);
        });
        state.profile.upload = mbps && mbps > 0 ? round1(mbps) : (applyFallback('upload'), state.profile.upload);
        document.getElementById('liveUpload').textContent = state.profile.upload.toFixed(1);
      } else if (stageName === 'finish') {
        await sleep(duration);
      }
    } catch (err) {
      console.error('Network Test — pengukuran tahap ' + stageName + ' gagal:', err);
      if (stageName !== 'connect' && stageName !== 'finish') applyFallback(stageName);
    }

    ringDone = true;
    if (!state.running) return;
    state.stageBusy = false;
    setStageDone(stageName);
    updateDialProgress(overallProgress(index));

    if (index === state.stages.length - 1) { finishTest(); return; }
    if (state.mode === 'auto') {
      runStage(index + 1);
    } else {
      // manual: berhenti dan tunggu klik berikutnya
      document.getElementById('dialLabel').textContent = 'LANJUT';
      document.getElementById('dialSub').textContent = `Lanjut: ${stageLabel(state.stages[index + 1])}`;
    }
  }

  function stageLabel(name) {
    return {
      connect: 'Hubungkan Server', ping: 'Uji Ping', download: 'Uji Download',
      upload: 'Uji Upload', finish: 'Selesaikan Analisis'
    }[name];
  }

  function overallProgress(stageIndex) {
    let acc = 0;
    for (let i = 0; i <= stageIndex; i++) acc += STAGE_WEIGHT[state.stages[i]];
    return acc;
  }

  function updateDialProgress(fraction) {
    const circumference = 653.45;
    const offset = circumference * (1 - clamp(fraction, 0, 1));
    document.getElementById('dialProgress').style.strokeDashoffset = offset;
  }

  function resetStageUI() {
    document.querySelectorAll('.stage-item').forEach(el => {
      el.classList.remove('is-active', 'is-done');
    });
    updateDialProgress(0);
    document.getElementById('livePing').textContent = '0';
    document.getElementById('liveDownload').textContent = '0.0';
    document.getElementById('liveUpload').textContent = '0.0';
  }

  function setStageActive(name) {
    document.querySelectorAll('.stage-item').forEach(el => el.classList.remove('is-active'));
    const el = document.querySelector(`.stage-item[data-stage="${name}"]`);
    if (el) el.classList.add('is-active');
  }
  function setStageDone(name) {
    const el = document.querySelector(`.stage-item[data-stage="${name}"]`);
    if (el) { el.classList.remove('is-active'); el.classList.add('is-done'); }
  }

  function stopTest(manualCancel) {
    state.running = false;
    const dialBtn = document.getElementById('testButton');
    dialBtn.classList.remove('is-testing', 'is-redo');
    document.getElementById('dialLabel').classList.remove('is-testing');
    document.getElementById('dialLabel').textContent = 'MULAI';
    document.getElementById('dialSub').textContent = 'Tekan untuk menguji';
    if (manualCancel) {
      setNetworkStatus('connected');
      showToast('error', 'Pengujian dihentikan oleh pengguna.', 'x-circle');
    }
  }

  function finishTest() {
    state.running = false;
    const profile = state.profile;
    const score = computeScore(profile);

    updateDialProgress(1);

    const dialBtn = document.getElementById('testButton');
    dialBtn.classList.remove('is-testing');
    dialBtn.classList.add('is-redo');
    document.getElementById('dialLabel').classList.remove('is-testing');
    document.getElementById('dialLabel').textContent = 'MULAI';
    document.getElementById('dialSub').textContent = 'Uji ulang jaringan Anda';

    setNetworkStatus(profile.packetLoss < 2 && profile.jitter < 35 ? 'stable' : 'unstable');
    playBeep(880);
    showToast('success', 'Pengujian selesai! Hasil telah diperbarui.', 'check-circle-2');
    if (state.usedFallback) {
      showToast('info', 'Sebagian metrik memakai estimasi karena koneksi ke server pengujian sempat gagal.', 'alert-triangle');
    }

    renderResult(profile, score);
    saveHistoryEntry(profile, score);
    showToast('info', 'Hasil berhasil disimpan ke riwayat.', 'history');

    setTimeout(() => { document.getElementById('dialSub').textContent = 'Tekan untuk menguji'; }, 3200);
  }

  /* ------------------------------------------------------------------
     12. RENDER DASHBOARD HASIL
     ------------------------------------------------------------------ */
  function renderResult(profile, score) {
    state.lastResult = { ...profile, score };


    setMetric('resultPing', profile.ping.toFixed(0), gradePing(profile.ping));
    setMetric('resultDownload', profile.download.toFixed(1), gradeDownload(profile.download));
    setMetric('resultUpload', profile.upload.toFixed(1), gradeUpload(profile.upload));
    setMetric('resultJitter', profile.jitter.toFixed(1), gradeJitter(profile.jitter));
    setMetric('resultPacketLoss', profile.packetLoss.toFixed(1), gradeLoss(profile.packetLoss));

    document.getElementById('resultScore').textContent = score;
    const scoreGrade = gradeScore(score);
    const tagEl = document.getElementById('resultScoreTag');
    tagEl.textContent = gradeLabel[scoreGrade];
    tagEl.className = 'metric-card__tag ' + gradeTag[scoreGrade];

    const circumference = 326.7;
    document.getElementById('scoreGaugeProgress').style.strokeDashoffset = circumference * (1 - score / 100);

    document.getElementById('resultServer').textContent = state.selectedServer ? `${state.selectedServer.name}, Indonesia` : '—';

    renderAnalysis(profile, score);
    renderActivities(profile);
  }

  function setMetric(id, value, grade) {
    document.getElementById(id).textContent = value;
    const tagEl = document.getElementById(id + 'Tag');
    tagEl.textContent = gradeLabel[grade];
    tagEl.className = 'metric-card__tag ' + gradeTag[grade];
  }

  /* ------------------------------------------------------------------
     13. ANALISIS OTOMATIS
     ------------------------------------------------------------------ */
  function renderAnalysis(p, score) {
    const dGrade = gradeDownload(p.download);
    const pGrade = gradePing(p.ping);
    const jGrade = gradeJitter(p.jitter);
    const lGrade = gradeLoss(p.packetLoss);
    const sGrade = gradeScore(score);

    const s1 = `Kecepatan download anda berada di angka ${p.download.toFixed(1)} Mbps, tergolong ${gradeLabel[dGrade].toLowerCase()} dan ${p.download >= 25 ? 'mendukung' : 'kurang ideal untuk'} aktivitas streaming resolusi tinggi seperti 4K.`;
    const s2 = `Nilai ping ${p.ping.toFixed(0)} ms dengan jitter ${p.jitter.toFixed(1)} ms menunjukkan koneksi anda ${(pGrade === 'sb' || pGrade === 'b') && (jGrade === 'sb' || jGrade === 'b') ? 'cukup responsif' : 'kurang responsif'} untuk video call dan permainan online.`;
    const s3 = `Packet loss tercatat ${p.packetLoss.toFixed(1)}%, sehingga koneksi anda ${lGrade === 'sb' || lGrade === 'b' ? 'tergolong stabil' : 'berpotensi mengalami gangguan'} saat mengunggah berkas besar dengan kecepatan upload ${p.upload.toFixed(1)} Mbps.`;
    const s4 = `Secara keseluruhan, jaringan anda memperoleh Network Quality Score ${score}/100. ${scoreSummary(sGrade)}`;

    document.getElementById('analysisText').textContent = `${s1} ${s2} ${s3} ${s4}`;
  }

  function scoreSummary(grade) {
    return {
      sb: 'Kualitas koneksi sangat baik dan siap untuk hampir semua aktivitas digital.',
      b: 'Kualitas koneksi baik dan mampu menangani sebagian besar aktivitas harian dengan lancar.',
      c: 'Kualitas koneksi cukup, namun mungkin terasa terbatas pada aktivitas yang menuntut bandwidth besar.',
      k: 'Kualitas koneksi kurang optimal dan disarankan untuk memeriksa jaringan atau perangkat anda.'
    }[grade];
  }

  /* ------------------------------------------------------------------
     14. KELAYAKAN AKTIVITAS
     ------------------------------------------------------------------ */
  function renderActivities(p) {
    const items = [
      { name: 'Streaming HD (1080p)', icon: 'monitor-play', status: p.download >= 8 && p.packetLoss < 2 ? 'good' : p.download >= 5 ? 'fair' : 'poor' },
      { name: 'Streaming 4K', icon: 'tv-2', status: p.download >= 25 && p.jitter < 30 && p.packetLoss < 1 ? 'good' : p.download >= 15 ? 'fair' : 'poor' },
      { name: 'Video Call', icon: 'video', status: p.ping < 100 && p.jitter < 30 && p.upload >= 3 ? 'good' : p.ping < 180 && p.upload >= 1.5 ? 'fair' : 'poor' },
      { name: 'Gaming Online', icon: 'gamepad-2', status: p.ping < 40 && p.jitter < 20 && p.packetLoss < 1 ? 'good' : p.ping < 80 && p.packetLoss < 3 ? 'fair' : 'poor' },
      { name: 'Upload Berkas Besar', icon: 'upload-cloud', status: p.upload >= 15 ? 'good' : p.upload >= 5 ? 'fair' : 'poor' },
      { name: 'Browsing Umum', icon: 'globe', status: p.download >= 3 && p.ping < 250 ? 'good' : p.download >= 1 ? 'fair' : 'poor' }
    ];

    const statusLabel = { good: 'Sangat Baik', fair: 'Cukup', poor: 'Kurang' };
    const list = document.getElementById('activityList');
    list.innerHTML = items.map(it => `
      <div class="activity-item">
        <span class="activity-item__icon"><i data-lucide="${it.icon}"></i></span>
        <span class="activity-item__name">${it.name}</span>
        <span class="activity-item__status status--${it.status}">${statusLabel[it.status]}</span>
      </div>
    `).join('');
    refreshIcons();
  }

  /* ------------------------------------------------------------------
     15. RIWAYAT & PERBANDINGAN
     ------------------------------------------------------------------ */
  function initHistory() {
    renderHistoryTable();
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      try { localStorage.removeItem(STORAGE_HISTORY); }
      catch (err) { console.error('Network Test — gagal menghapus riwayat:', err); }
      renderHistoryTable();
      document.getElementById('comparisonBox').hidden = true;
      showToast('info', 'Riwayat pengujian telah dihapus.', 'trash-2');
    });
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_HISTORY)) || []; }
    catch (e) { return []; }
  }

  function saveHistoryEntry(p, score) {
    const history = getHistory();
    const now = new Date();
    const entry = {
      date: now.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
      time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      ping: p.ping, download: p.download, upload: p.upload,
      jitter: p.jitter, packetLoss: p.packetLoss, score
    };
    history.unshift(entry);
    if (history.length > 50) history.pop();
    try { localStorage.setItem(STORAGE_HISTORY, JSON.stringify(history)); }
    catch (err) { console.error('Network Test — gagal menyimpan riwayat:', err); }
    renderHistoryTable();
    renderComparison(history);
  }

  function renderHistoryTable() {
    const history = getHistory();
    const body = document.getElementById('historyBody');
    document.getElementById('historyCount').textContent = `${history.length} pengujian tersimpan`;

    if (history.length === 0) {
      body.innerHTML = `<tr class="history-empty-row"><td colspan="6">Belum ada riwayat pengujian. Jalankan Network Test untuk mulai merekam hasil.</td></tr>`;
      return;
    }
    body.innerHTML = history.slice(0, 20).map(h => `
      <tr>
        <td>${h.date}</td>
        <td>${h.time}</td>
        <td>${h.ping.toFixed(0)} ms</td>
        <td>${h.download.toFixed(1)} Mbps</td>
        <td>${h.upload.toFixed(1)} Mbps</td>
        <td>${h.score}/100</td>
      </tr>
    `).join('');
  }

  function renderComparison(history) {
    const box = document.getElementById('comparisonBox');
    if (history.length < 2) { box.hidden = true; return; }
    const current = history[0], previous = history[1];
    const rows = [
      { label: 'Download', cur: current.download, prev: previous.download, unit: 'Mbps' },
      { label: 'Upload', cur: current.upload, prev: previous.upload, unit: 'Mbps' },
      { label: 'Ping', cur: current.ping, prev: previous.ping, unit: 'ms', inverse: true },
      { label: 'Skor', cur: current.score, prev: previous.score, unit: '' }
    ];
    document.getElementById('comparisonRow').innerHTML = rows.map(r => {
      const diff = r.cur - r.prev;
      const pct = r.prev !== 0 ? Math.abs((diff / r.prev) * 100).toFixed(0) : 0;
      let cls = 'is-flat', icon = 'minus', sign = '';
      const improved = r.inverse ? diff < 0 : diff > 0;
      const worsened = r.inverse ? diff > 0 : diff < 0;
      if (improved && Math.abs(diff) > 0.05) { cls = 'is-up'; icon = 'trending-up'; sign = '+'; }
      else if (worsened && Math.abs(diff) > 0.05) { cls = 'is-down'; icon = 'trending-down'; sign = '-'; }
      return `<span class="comparison-chip ${cls}"><i data-lucide="${icon}"></i> ${r.label} ${sign}${pct}%</span>`;
    }).join('');
    box.hidden = false;
    refreshIcons();
  }

  /* ------------------------------------------------------------------
     16. EXPORT — PDF, Salin, Bagikan
     ------------------------------------------------------------------ */
  function initExport() {
    document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
    document.getElementById('copyResultBtn').addEventListener('click', copyResult);
    document.getElementById('shareResultBtn').addEventListener('click', shareResult);
  }

  function buildResultText() {
    const r = state.lastResult;
    if (!r) return null;
    return [
      'Hasil Network Test',
      `Ping: ${r.ping.toFixed(0)} ms`,
      `Download: ${r.download.toFixed(1)} Mbps`,
      `Upload: ${r.upload.toFixed(1)} Mbps`,
      `Jitter: ${r.jitter.toFixed(1)} ms`,
      `Packet Loss: ${r.packetLoss.toFixed(1)}%`,
      `Network Quality Score: ${r.score}/100`,
      `Server: ${state.selectedServer ? state.selectedServer.name + ', Indonesia' : '-'}`,
      `IP: ${state.ipInfo ? state.ipInfo.ip : '-'}`,
      'Network Test by Fikarroyal'
    ].join('\n');
  }

  function exportPdf() {
    const r = state.lastResult;
    if (!r) { showToast('error', 'Jalankan pengujian terlebih dahulu sebelum mengunduh PDF.', 'alert-triangle'); return; }
    if (!window.jspdf || !window.jspdf.jsPDF) {
      showToast('error', 'Modul PDF belum siap. Periksa koneksi internet Anda dan coba lagi.', 'alert-triangle');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    // ---------- Palet warna (disamakan dengan tema web) ----------
    const C = {
      accent: [47, 127, 255],
      accentStrong: [10, 91, 216],
      navy: [13, 37, 68],
      navySoft: [53, 80, 111],
      muted: [91, 117, 145],
      faint: [138, 161, 184],
      softBg: [235, 244, 253],
      lightLine: [214, 231, 250],
      white: [255, 255, 255],
      good: [18, 164, 102], goodBg: [231, 247, 240],
      fair: [199, 130, 21], fairBg: [253, 239, 220],
      poor: [212, 68, 62], poorBg: [251, 227, 225]
    };
    const gradeColor = { sb: C.good, b: C.good, c: C.fair, k: C.poor };
    const gradeBg = { sb: C.goodBg, b: C.goodBg, c: C.fairBg, k: C.poorBg };

    const pageW = 210, marginX = 14, contentX = marginX + 8;
    const rightX = 210 - contentX;

    // ---------- Bingkai luar ----------
    doc.setDrawColor(...C.lightLine);
    doc.setLineWidth(0.6);
    doc.roundedRect(marginX, marginX, pageW - marginX * 2, 297 - marginX * 2, 4, 4, 'S');
    doc.setDrawColor(...C.accent);
    doc.setLineWidth(1.1);
    doc.roundedRect(marginX + 2.2, marginX + 2.2, pageW - (marginX + 2.2) * 2, 297 - (marginX + 2.2) * 2, 3, 3, 'S');

    // ---------- Header: logo + wordmark ----------
    const logoX = contentX, logoY = 22, logoSize = 15;
    doc.setFillColor(...C.accent);
    doc.roundedRect(logoX, logoY, logoSize, logoSize, 3.2, 3.2, 'F');
    const glyphCx = logoX + logoSize / 2, glyphCy = logoY + logoSize / 2;
    doc.setDrawColor(...C.white);
    doc.setLineWidth(0.6);
    doc.circle(glyphCx, glyphCy, 4.3, 'S');
    doc.circle(glyphCx, glyphCy, 2.3, 'S');
    doc.setFillColor(...C.white);
    doc.circle(glyphCx, glyphCy, 0.8, 'F');

    const wordX = logoX + logoSize + 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...C.navy);
    doc.text('Network', wordX, logoY + 6.5);
    const networkWidth = doc.getTextWidth('Network ');
    doc.setTextColor(...C.accentStrong);
    doc.text('Test', wordX + networkWidth, logoY + 6.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.muted);
    doc.text('Laporan Hasil Pengujian Jaringan', wordX, logoY + 12);

    doc.setFontSize(7.5);
    doc.setTextColor(...C.faint);
    doc.text('TANGGAL PENGUJIAN', rightX, logoY + 3, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.navySoft);
    doc.text(new Date().toLocaleString('id-ID'), rightX, logoY + 8.5, { align: 'right' });

    let y = logoY + logoSize + 7;
    doc.setDrawColor(...C.lightLine);
    doc.setLineWidth(0.4);
    doc.line(contentX, y, rightX, y);
    y += 10;

    // ---------- Kartu skor utama (gaya "profil" pada CV) ----------
    const scoreGrade = gradeScore(r.score);
    const cardH = 34;
    doc.setFillColor(...C.softBg);
    doc.roundedRect(contentX, y, rightX - contentX, cardH, 4, 4, 'F');

    const badgeCx = contentX + 20, badgeCy = y + cardH / 2, badgeR = 13;
    doc.setDrawColor(...C.lightLine);
    doc.setLineWidth(3.2);
    doc.circle(badgeCx, badgeCy, badgeR, 'S');
    doc.setDrawColor(...gradeColor[scoreGrade]);
    doc.circle(badgeCx, badgeCy, badgeR, 'S');
    doc.setFillColor(...C.white);
    doc.circle(badgeCx, badgeCy, badgeR - 1.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...C.navy);
    doc.text(String(r.score), badgeCx, badgeCy + 1.6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.faint);
    doc.text('/100', badgeCx, badgeCy + 5.8, { align: 'center' });

    const infoX = contentX + 44;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.faint);
    doc.text('NETWORK QUALITY SCORE', infoX, y + 9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...gradeColor[scoreGrade]);
    doc.text(gradeLabel[scoreGrade], infoX, y + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.navySoft);
    const summaryLines = doc.splitTextToSize(scoreSummary(scoreGrade), rightX - infoX);
    doc.text(summaryLines.slice(0, 2), infoX, y + 22);

    y += cardH + 12;

    // ---------- Helper: judul section dengan aksen bar ----------
    function sectionTitle(title) {
      doc.setFillColor(...C.accent);
      doc.rect(contentX, y - 3.6, 1.3, 5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...C.navy);
      doc.text(title, contentX + 4, y);
      y += 8;
    }

    // ---------- Helper: baris label/nilai + badge kualitas opsional ----------
    function metricRow(label, value, grade) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text(label, contentX, y);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...C.navy);
      doc.text(value, contentX + 62, y);

      if (grade) {
        const label2 = gradeLabel[grade];
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        const tw = doc.getTextWidth(label2);
        const padX = 3, badgeW = tw + padX * 2, badgeH = 5.6;
        const bx = rightX - badgeW;
        doc.setFillColor(...gradeBg[grade]);
        doc.roundedRect(bx, y - 4.1, badgeW, badgeH, 2.4, 2.4, 'F');
        doc.setTextColor(...gradeColor[grade]);
        doc.text(label2, bx + padX, y - 0.1);
      }

      doc.setDrawColor(...C.lightLine);
      doc.setLineWidth(0.3);
      doc.line(contentX, y + 3.2, rightX, y + 3.2);
      y += 10.5;
    }

    sectionTitle('Detail Pengukuran');
    metricRow('PING', `${r.ping.toFixed(0)} ms`, gradePing(r.ping));
    metricRow('DOWNLOAD', `${r.download.toFixed(1)} Mbps`, gradeDownload(r.download));
    metricRow('UPLOAD', `${r.upload.toFixed(1)} Mbps`, gradeUpload(r.upload));
    metricRow('JITTER', `${r.jitter.toFixed(1)} ms`, gradeJitter(r.jitter));
    metricRow('PACKET LOSS', `${r.packetLoss.toFixed(1)} %`, gradeLoss(r.packetLoss));

    y += 4;
    sectionTitle('Informasi Jaringan');
    metricRow('IP ADDRESS', state.ipInfo ? state.ipInfo.ip : '-', null);
    metricRow('ISP', state.ipInfo ? state.ipInfo.isp : '-', null);
    metricRow('LOKASI', state.ipInfo ? state.ipInfo.location : '-', null);
    metricRow('SERVER', state.selectedServer ? `${state.selectedServer.name}, Indonesia` : '-', null);

    doc.save('network-test-hasil.pdf');
    showToast('success', 'Hasil berhasil diunduh sebagai PDF.', 'file-down');
  }

  function copyResult() {
    const text = buildResultText();
    if (!text) { showToast('error', 'Belum ada hasil untuk disalin.', 'alert-triangle'); return; }
    navigator.clipboard.writeText(text).then(() => {
      showToast('success', 'Hasil berhasil disalin ke clipboard.', 'copy');
    }).catch(() => {
      showToast('error', 'Gagal menyalin hasil.', 'x-circle');
    });
  }

  function shareResult() {
    const text = buildResultText();
    if (!text) { showToast('error', 'Belum ada hasil untuk dibagikan.', 'alert-triangle'); return; }
    if (navigator.share) {
      navigator.share({ title: 'Hasil Network Test', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      showToast('info', 'Berbagi langsung tidak didukung. Hasil disalin ke clipboard.', 'share-2');
    }
  }

  /* ------------------------------------------------------------------
     17. TOAST NOTIFICATIONS
     ------------------------------------------------------------------ */
  function showToast(type, message, icon) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast type--${type}`;
    toast.innerHTML = `
      <span class="toast__icon"><i data-lucide="${icon || 'info'}"></i></span>
      <span class="toast__text">${message}</span>
    `;
    container.appendChild(toast);
    refreshIcons();
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 380);
    }, 3800);
  }

  /* ------------------------------------------------------------------
     18. PENGATURAN TAMPILAN (default tetap)
     ------------------------------------------------------------------ */
  function applySettings() {
    document.body.classList.toggle('no-animation', !settings.animation);
    if (typeof window.__heroCanvasRebuild === 'function') window.__heroCanvasRebuild();
  }

  function scheduleAutoInterval() {
    if (state.autoTimer) clearInterval(state.autoTimer);
    if (settings.autoInterval > 0) {
      state.autoTimer = setInterval(() => {
        if (!state.running) {
          setMode('auto');
          startTest();
          showToast('info', 'Pengujian otomatis berkala telah dijalankan.', 'repeat');
        }
      }, settings.autoInterval * 60 * 1000);
    }
  }

  /* ------------------------------------------------------------------
     19. EFEK SUARA RINGAN (WebAudio)
     ------------------------------------------------------------------ */
  let audioCtx;
  function playBeep(freq) {
    if (!settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (e) { /* abaikan jika WebAudio tidak tersedia */ }
  }

  /* ------------------------------------------------------------------
     20. UTIL
     ------------------------------------------------------------------ */
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function debounce(fn, wait) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }
  function refreshIcons() {
    try { if (typeof lucide !== 'undefined') lucide.createIcons(); }
    catch (err) { console.error('Network Test — gagal merender ikon:', err); }
  }

})();
