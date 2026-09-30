(function () {
    'use strict';

    /*  Hover Peek v1.1 — Jellyfin 12 · JavaScript Injector
     *  Shows a details tooltip when hovering Movie, Series, Season, Episode (optional) and Person cards.
     *  Shares the #jf-hover-tooltip element with Jellyfin-Episodes-Ratings-Grid; styled by ElegantFin / elegantfin-jf12 when present.
     *  Server side: targeted /Items queries (ids + selected fields, no images) — database only, media files are never read.
     *  Mouse only: touch and pen input are ignored, so long-press multi-select on touch screens is left untouched.
     *
     *  SETTINGS
     */
    const CONFIG = {
        DELAY_MS: 700,                     // Hover time (ms) before the tooltip appears
        WARM_DELAY_MS: 300,                // Shorter delay (ms) when moving straight from one card to the next
        MOVIES: true,                      // Tooltip on movies
        SERIES: true,                      // Tooltip on series
        SEASONS: true,                     // Tooltip on seasons
        EPISODES: true,                    // Tooltip on episodes (Continue Watching, Next Up, Latest…)
        PEOPLE: true,                      // Tooltip on people (cast & crew)
        WIDTH_PX: 400,                     // Tooltip width (px)
        OVERVIEW_LINES: 6,                 // Max lines of synopsis / biography
        SHOW_ORIGINAL_TITLE: true,         // Original title when different from the displayed title
        SHOW_RUNTIME: true,                // Runtime (movies, episodes)
        SHOW_COMMUNITY_RATING: true,       // Community rating (yellow star)
        SHOW_CRITIC_RATING: true,          // Critic rating (blue star), only when the item has one in its metadata
        SHOW_OFFICIAL_RATING: false,       // Parental rating (PG-13, FR-12…)
        SHOW_GENRES: true,                 // Genres line
        MAX_GENRES: 3,                     // Max number of genres
        SHOW_TAGLINE: false,               // Movie tagline
        SHOW_COUNTS: true,                 // Number of seasons / episodes
        SEASON_USE_SERIES_INFO: true,      // Seasons: use the series genres, and the series synopsis when the season has none
        PERSON_FILMOGRAPHY: true,          // People: movies / series available on this server
        PERSON_FILMOGRAPHY_LABEL: true,    // People: short label before the counts ("Here" / "Dispo")
        PERSON_FILMOGRAPHY_LIMIT: 8,       // People: number of titles listed (0 = counts only)
        PERSON_FILMOGRAPHY_SORT: 'recent', // People: 'recent' | 'rating' | 'name'
        CACHE_MINUTES: 30,                 // In-memory cache lifetime (minutes)
        LANGUAGE: 'auto'                   // 'auto' (Jellyfin display language: French or English) | 'fr' | 'en'
    };

    if (window.__jfHoverPeek) return;
    window.__jfHoverPeek = true;

    const TIP = 'jf-hover-tooltip';
    const SEL = '.card[data-id]';
    const KINDS = new Set([CONFIG.MOVIES && 'Movie', CONFIG.SERIES && 'Series', CONFIG.SEASONS && 'Season', CONFIG.EPISODES && 'Episode'].filter(Boolean));
    const TTL = Math.max(1, +CONFIG.CACHE_MINUTES || 30) * 60000;
    const WIDTH = Math.max(200, +CONFIG.WIDTH_PX || 400);
    const LINES = Math.max(1, +CONFIG.OVERVIEW_LINES || 6);
    const LIMIT = Math.max(0, +CONFIG.PERSON_FILMOGRAPHY_LIMIT || 0);
    const CAP = { capture: true, passive: true };
    const SORTS = {
        recent: ['PremiereDate,ProductionYear,SortName', 'Descending,Descending,Ascending'],
        rating: ['CommunityRating,SortName', 'Descending,Ascending'],
        name: ['SortName', 'Ascending']
    };
    const I18N = {
        en: {
            present: 'present', season: ['season', 'seasons'], episode: ['episode', 'episodes'],
            movie: ['movie', 'movies'], series: ['series', 'series'], tv: 'series', here: 'Here',
            more: n => '+ ' + n + ' more',
            age: n => 'age ' + n,
            runtime: m => m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + 'm'
        },
        fr: {
            present: 'présent', season: ['saison', 'saisons'], episode: ['épisode', 'épisodes'],
            movie: ['film', 'films'], series: ['série', 'séries'], tv: 'série', here: 'Dispo',
            more: n => '+ ' + n + (n > 1 ? ' autres' : ' autre'),
            age: n => n + (n > 1 ? ' ans' : ' an'),
            runtime: m => m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '') : m + ' min'
        }
    };

    const T = '#' + TIP;
    const S = ':where(' + T + ')';
    const CSS = [
        T + '{position:fixed;left:0;top:0;z-index:99999;box-sizing:border-box;width:min(320px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:hidden;overflow-wrap:break-word;padding:16px;border-radius:var(--ef12-surfaceRadius,var(--largeRadius,10px));background:var(--drawerColor,rgba(15,15,15,.97));color:var(--textColor,#fff);border:var(--defaultBorder,1px solid rgba(255,255,255,.15));box-shadow:var(--cardShadow,0 12px 40px rgba(0,0,0,.8));-webkit-backdrop-filter:var(--ef12-surfaceBlur,var(--blurDefault,blur(12px)));backdrop-filter:var(--ef12-surfaceBlur,var(--blurDefault,blur(12px)));font-family:inherit;pointer-events:none;opacity:0;transition:opacity .2s ease-in-out;display:none}',
        '@supports (background:color-mix(in srgb,red,blue)){' + T + '{background:color-mix(in srgb,var(--drawerColor,rgba(15,15,15,.95)) 65%,var(--darkerGradientPoint,#0b0b0b))}}',
        T + '.visible{opacity:1;display:block}',
        '@starting-style{' + T + '.visible{opacity:0}}',
        '.jf-tooltip-title{font-size:1.15em;font-weight:800;margin:0 0 6px;color:var(--fullContrastColor,#fff);line-height:1.2}',
        '.jf-tooltip-meta{font-size:.8em;color:var(--dimTextColor,#10b981);margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}',
        '.jf-tooltip-overview{font-size:.85em;line-height:1.5;color:var(--textColor,#d1d5db);display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}',
        S + ' .jf-tooltip-meta>span{color:var(--borderColor,#666);margin-inline:.45em}',
        S + ' .jf-hp>:last-child{margin-bottom:0}',
        S + ' .jf-hp-sub{font-size:.85em;line-height:1.35;color:var(--dimTextColor,#9ca3af);margin:-2px 0 8px}',
        S + ' .jf-hp-i{font-style:italic}',
        S + ' .jf-hp-w{font-style:normal;white-space:nowrap}',
        S + ' .jf-hp-cr{display:inline-block;font-style:normal;filter:hue-rotate(170deg) saturate(1.4)}',
        S + ' .jf-tooltip-meta.jf-hp-tight{margin-bottom:4px}',
        S + ' .jf-tooltip-overview.jf-hp-ov{-webkit-line-clamp:' + LINES + ';line-clamp:' + LINES + '}',
        S + ' .jf-hp-films{margin-top:12px;padding-top:10px;border-top:1px solid var(--darkerBorderColor,rgba(255,255,255,.1))}',
        S + ' .jf-hp-films>.jf-tooltip-meta{margin-bottom:6px}',
        S + ' .jf-hp-films>:last-child{margin-bottom:0}',
        S + ' .jf-hp-row{display:flex;align-items:baseline;gap:.6em;font-size:.82em;line-height:1.5;white-space:nowrap;color:var(--textColor,#d1d5db)}',
        S + ' .jf-hp-y{flex:none;min-width:2.4em;color:var(--dimTextColor,#9ca3af);font-variant-numeric:tabular-nums}',
        S + ' .jf-hp-n{min-width:0;overflow:hidden;text-overflow:ellipsis}',
        S + ' .jf-hp-k{flex:none;font-size:.85em;color:var(--dimTextColor,#9ca3af)}',
        S + ' .jf-hp-more{margin-top:2px;font-size:.78em;color:var(--dimTextColor,#9ca3af)}'
    ].join('\n');

    let tip = null, root = null, cur = null, blocked = null, timer = 0, raf = 0, seq = 0;
    let shown = false, armed = false, styled = false, warm = 0, mx = 0, my = 0, tw = 0, th = 0;

    const lang = () => String((CONFIG.LANGUAGE !== 'auto' && CONFIG.LANGUAGE) || document.documentElement.lang || navigator.language || 'en');
    const tr = () => I18N[lang().slice(0, 2).toLowerCase()] || I18N.en;
    const pl = (n, w) => n + ' ' + w[n > 1 ? 1 : 0];
    const ymd = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m && +m[1] > 1800 ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
    const yearOf = s => { const m = /^(\d{4})/.exec(s || ''); return m && +m[1] > 1800 ? +m[1] : null; };
    const ageAt = (b, e) => {
        const x = new Date(b), y = new Date(e);
        let a = y.getUTCFullYear() - x.getUTCFullYear();
        if (y.getUTCMonth() < x.getUTCMonth() || (y.getUTCMonth() === x.getUTCMonth() && y.getUTCDate() < x.getUTCDate())) a--;
        return a;
    };
    const country = s => {
        if (!s) return '';
        const now = /\[\s*now\s+([^\]]+)\]/i.exec(s);
        if (now) return now[1].trim();
        const p = String(s).replace(/\[[^\]]*\]|\([^)]*\)/g, '').split(',').map(x => x.trim()).filter(Boolean);
        return p.length ? p[p.length - 1] : '';
    };
    const tpl = document.createElement('template');
    const clean = s => {
        if (!s) return '';
        s = String(s);
        if (/[<&]/.test(s)) { tpl.innerHTML = s.replace(/<br\s*\/?>/gi, ' '); s = tpl.content.textContent || ''; tpl.innerHTML = ''; }
        return s.replace(/\s+/g, ' ').trim();
    };
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

    const api = () => {
        const c = window.ApiClient;
        if (!c || typeof c.getJSON !== 'function' || typeof c.getUrl !== 'function' || typeof c.getCurrentUserId !== 'function') return null;
        const u = c.getCurrentUserId();
        return u ? { c, u } : null;
    };
    const query = (a, p) => a.c.getJSON(a.c.getUrl('Items?' + new URLSearchParams(p)));

    const cache = new Map(), inflight = new Map();
    const put = (k, v, ttl) => {
        cache.delete(k);
        cache.set(k, { v, e: Date.now() + ttl });
        if (cache.size > 300) cache.delete(cache.keys().next().value);
    };
    const memo = (k, fn) => {
        const h = cache.get(k);
        if (h && h.e > Date.now()) return Promise.resolve(h.v);
        let p = inflight.get(k);
        if (!p) {
            p = Promise.resolve().then(fn)
                .then(v => { put(k, v, v ? TTL : 30000); return v; }, () => { put(k, null, 30000); return null; })
                .finally(() => inflight.delete(k));
            inflight.set(k, p);
        }
        return p;
    };

    const fieldsFor = k => {
        if (k === 'Person') return 'Overview,ProductionLocations' + (CONFIG.PERSON_FILMOGRAPHY ? ',ItemCounts' : '');
        const f = ['Overview'];
        if ((k === 'Movie' || k === 'Series') && CONFIG.SHOW_GENRES) f.push('Genres');
        if ((k === 'Movie' || k === 'Series') && CONFIG.SHOW_ORIGINAL_TITLE) f.push('OriginalTitle');
        if (k === 'Movie' && CONFIG.SHOW_TAGLINE) f.push('Taglines');
        if ((k === 'Series' || k === 'Season') && CONFIG.SHOW_COUNTS) f.push('ChildCount');
        if (k === 'Series' && CONFIG.SHOW_COUNTS) f.push('RecursiveItemCount');
        return f.join(',');
    };
    const getItem = (a, id, k) => memo(a.u + '|' + id, () => {
        const p = { ids: id, userId: a.u, fields: fieldsFor(k), enableUserData: k === 'Series' && !!CONFIG.SHOW_COUNTS, enableTotalRecordCount: false };
        if (k === 'Season' || k === 'Episode') { p.enableImages = true; p.enableImageTypes = 'Primary'; p.imageTypeLimit = 1; } else p.enableImages = false;
        return query(a, p).then(r => (r && r.Items && r.Items[0]) || null);
    });
    const getFilms = (a, id) => memo(a.u + '|f|' + id, () => {
        const s = SORTS[CONFIG.PERSON_FILMOGRAPHY_SORT] || SORTS.recent;
        return query(a, {
            personIds: id, userId: a.u, recursive: true, includeItemTypes: 'Movie,Series',
            sortBy: s[0], sortOrder: s[1], limit: LIMIT, collapseBoxSetItems: false,
            enableImages: false, enableUserData: false, enableTotalRecordCount: false
        }).then(r => (r && r.Items) || []);
    });

    const blank = () => ({ title: '', sub: '', italic: false, meta: [], genres: '', tagline: '', overview: '', films: null });

    const itemModel = (it, k, parent) => {
        const L = tr(), m = blank();
        if (k === 'Season') {
            m.title = it.SeriesName || it.Name || '';
            m.sub = it.SeriesName ? it.Name || '' : '';
        } else if (k === 'Episode') {
            m.title = it.Name || it.SeriesName || '';
            m.sub = it.Name && it.SeriesName ? it.SeriesName : '';
            const code = (it.ParentIndexNumber != null ? 'S' + it.ParentIndexNumber + ':' : '') + (it.IndexNumber != null ? 'E' + it.IndexNumber + (it.IndexNumberEnd > it.IndexNumber ? '-' + it.IndexNumberEnd : '') : '');
            if (code) m.meta.push(code);
        } else {
            m.title = it.Name || '';
            if (CONFIG.SHOW_ORIGINAL_TITLE && it.OriginalTitle && !same(it.OriginalTitle, it.Name)) { m.sub = it.OriginalTitle; m.italic = true; }
        }
        const y = it.ProductionYear || yearOf(it.PremiereDate);
        if (y && k === 'Series') {
            const e = yearOf(it.EndDate);
            m.meta.push(it.Status === 'Continuing' ? y + ' –\u2060 ' + L.present : e && e !== y ? y + ' –\u2060 ' + e : String(y));
        } else if (y) m.meta.push(String(y));
        if ((k === 'Movie' || k === 'Episode') && CONFIG.SHOW_RUNTIME && it.RunTimeTicks > 0) m.meta.push(L.runtime(Math.max(1, Math.round(it.RunTimeTicks / 6e8))));
        if (CONFIG.SHOW_COUNTS) {
            if (k === 'Series' && it.ChildCount > 0) m.meta.push(pl(it.ChildCount, L.season));
            if (k === 'Series' && it.RecursiveItemCount > 0) m.meta.push(pl(it.RecursiveItemCount, L.episode));
            if (k === 'Season' && it.ChildCount > 0) m.meta.push(pl(it.ChildCount, L.episode));
        }
        if (CONFIG.SHOW_COMMUNITY_RATING && it.CommunityRating > 0) m.meta.push('⭐ ' + (+it.CommunityRating).toFixed(1));
        if (CONFIG.SHOW_CRITIC_RATING && it.CriticRating > 0) m.meta.push({ icon: '⭐', cls: 'jf-hp-cr', text: String(Math.round(it.CriticRating)) });
        if (CONFIG.SHOW_OFFICIAL_RATING && it.OfficialRating) m.meta.push(String(it.OfficialRating));
        const g = it.Genres && it.Genres.length ? it.Genres : parent && parent.Genres;
        if (CONFIG.SHOW_GENRES && k !== 'Episode' && g && g.length) m.genres = g.slice(0, Math.max(1, +CONFIG.MAX_GENRES || 3)).join(', ');
        if (k === 'Movie' && CONFIG.SHOW_TAGLINE && it.Taglines && it.Taglines[0]) m.tagline = clean(it.Taglines[0]);
        m.overview = clean(it.Overview) || (parent ? clean(parent.Overview) : '');
        return m;
    };

    const personModel = (p, films) => {
        const L = tr(), m = blank();
        m.title = p.Name || '';
        const b = ymd(p.PremiereDate), d = ymd(p.EndDate);
        const by = b != null ? new Date(b).getUTCFullYear() : null, dy = d != null ? new Date(d).getUTCFullYear() : null;
        if (by && dy) m.meta.push(by + ' –\u2060 ' + dy);
        else if (by) m.meta.push(String(by));
        else if (dy) m.meta.push('† ' + dy);
        if (b != null) {
            const a = ageAt(b, d != null ? d : Date.now());
            if (a >= 0 && a < 130) m.meta.push(L.age(a));
        }
        const c = country(p.ProductionLocations && p.ProductionLocations[0]);
        if (c) m.meta.push(c);
        m.overview = clean(p.Overview);
        if (CONFIG.PERSON_FILMOGRAPHY) {
            const mc = p.MovieCount || 0, sc = p.SeriesCount || 0, ec = p.EpisodeCount || 0, counts = [];
            if (mc) counts.push(pl(mc, L.movie));
            if (sc) counts.push(pl(sc, L.series));
            if (ec) counts.push(pl(ec, L.episode));
            const rows = (films || []).map(f => ({ y: f.ProductionYear || yearOf(f.PremiereDate) || '', n: f.Name || '', s: f.Type === 'Series' }));
            if (rows.length || counts.length) {
                m.films = { head: counts.length && CONFIG.PERSON_FILMOGRAPHY_LABEL ? [L.here].concat(counts) : counts, rows, more: rows.length ? Math.max(0, mc + sc - rows.length) : 0 };
            }
        }
        return m;
    };

    const model = async (id, k) => {
        const a = api();
        if (!a) return null;
        if (k === 'Person') {
            const r = await Promise.all([getItem(a, id, 'Person'), CONFIG.PERSON_FILMOGRAPHY && LIMIT > 0 ? getFilms(a, id) : null]);
            return r[0] ? personModel(r[0], r[1]) : null;
        }
        const it = await getItem(a, id, k);
        if (!it) return null;
        const parent = k === 'Season' && CONFIG.SEASON_USE_SERIES_INFO && it.SeriesId && (!it.Overview || CONFIG.SHOW_GENRES) ? await getItem(a, it.SeriesId, 'Series') : null;
        return itemModel(it, k, parent);
    };

    const el = (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    };
    const metaEl = (parts, extra) => {
        const d = el('div', 'jf-tooltip-meta' + (extra ? ' ' + extra : ''));
        parts.forEach((p, i) => {
            if (i) { d.appendChild(el('span', null, '|')); d.appendChild(document.createTextNode('\u200b')); }
            if (p && typeof p === 'object') { const w = el('i', 'jf-hp-w'); w.appendChild(el('i', p.cls, p.icon)); w.appendChild(document.createTextNode('\u00a0' + p.text)); d.appendChild(w); }
            else d.appendChild(document.createTextNode(String(p).replace(/ /g, '\u00a0')));
        });
        return d;
    };
    const render = m => {
        const L = tr(), r = el('div', 'jf-hp');
        r.appendChild(el('div', 'jf-tooltip-title', m.title));
        if (m.sub) r.appendChild(el('div', 'jf-hp-sub' + (m.italic ? ' jf-hp-i' : ''), m.sub));
        if (m.meta.length) r.appendChild(metaEl(m.meta, m.genres ? 'jf-hp-tight' : ''));
        if (m.genres) r.appendChild(el('div', 'jf-tooltip-meta', m.genres));
        if (m.tagline) r.appendChild(el('div', 'jf-hp-sub jf-hp-i', m.tagline));
        if (m.overview) r.appendChild(el('div', 'jf-tooltip-overview jf-hp-ov', m.overview));
        if (m.films) {
            const f = el('div', 'jf-hp-films');
            if (m.films.head.length) f.appendChild(metaEl(m.films.head));
            m.films.rows.forEach(x => {
                const row = el('div', 'jf-hp-row');
                row.appendChild(el('span', 'jf-hp-y', x.y ? String(x.y) : ''));
                row.appendChild(el('span', 'jf-hp-n', x.n));
                if (x.s) row.appendChild(el('span', 'jf-hp-k', L.tv));
                f.appendChild(row);
            });
            if (m.films.more) f.appendChild(el('div', 'jf-hp-more', L.more(m.films.more)));
            r.appendChild(f);
        }
        return r;
    };
    const worth = m => !!(m.title && (m.meta.length || m.genres || m.overview || m.sub || m.films));

    const ensureStyle = () => {
        if (styled) return;
        styled = true;
        const s = document.createElement('style');
        s.id = document.getElementById('jf-hover-tooltip-style') ? 'jf-hover-peek-style' : 'jf-hover-tooltip-style';
        s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
    };
    const tipEl = () => {
        if (tip && tip.isConnected) return tip;
        tip = document.getElementById(TIP);
        if (!tip) { tip = document.createElement('div'); tip.id = TIP; document.body.appendChild(tip); }
        return tip;
    };

    const place = () => {
        raf = 0;
        if (!shown || !tip) return;
        const g = 10, vw = window.innerWidth, vh = window.innerHeight;
        let x = mx + 15, y = my + 15;
        if (x + tw + g > vw) x = mx - 15 - tw;
        if (y + th + g > vh) y = my - 15 - th;
        tip.style.left = Math.max(g, Math.min(x, vw - tw - g)) + 'px';
        tip.style.top = Math.max(g, Math.min(y, vh - th - g)) + 'px';
    };

    const show = m => {
        if (document.hidden || !worth(m)) return;
        ensureStyle();
        const t = tipEl(), r = render(m);
        t.textContent = '';
        t.appendChild(r);
        root = r;
        t.style.width = 'min(' + WIDTH + 'px, calc(100vw - 20px))';
        t.classList.add('visible');
        shown = true;
        tw = t.offsetWidth;
        th = t.offsetHeight;
        place();
    };

    const hide = leave => {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        seq++;
        if (shown) {
            shown = false;
            warm = leave ? Date.now() + 600 : 0;
            if (tip && root && root.parentNode === tip) { tip.classList.remove('visible'); tip.style.width = ''; }
        } else if (!leave) warm = 0;
        root = null;
        cur = null;
        disarm();
    };

    const load = async s => {
        const c = cur;
        if (!c || s !== seq) return;
        let m = null;
        try { m = await model(c.id, c.kind); } catch (_) { m = null; }
        if (!m || s !== seq || cur !== c) return;
        if (!c.el.isConnected) {
            const at = document.elementFromPoint(mx, my);
            const card = at && at.closest ? at.closest(SEL) : null;
            if (!card || card.getAttribute('data-id') !== c.id) { hide(true); return; }
            c.el = card;
        }
        if (c.el.querySelector('.itemSelectionPanel')) return;
        show(m);
    };

    const kindOf = card => {
        if (card.closest('.detailImageContainer') || card.querySelector('.itemSelectionPanel')) return null;
        const type = card.getAttribute('data-type');
        if (type === 'Person' || card.classList.contains('personCard')) return CONFIG.PEOPLE ? 'Person' : null;
        return KINDS.has(type) ? type : null;
    };

    const onMove = e => {
        mx = e.clientX;
        my = e.clientY;
        if (shown && !raf) raf = requestAnimationFrame(place);
    };
    const onKill = () => { if (cur) blocked = cur.id; hide(false); };
    const onOut = e => { if (!e.relatedTarget) hide(false); };
    const onVis = () => { if (document.hidden) hide(false); };

    function arm() {
        if (armed) return;
        armed = true;
        document.addEventListener('pointermove', onMove, CAP);
        document.addEventListener('pointerout', onOut, CAP);
        document.addEventListener('pointerdown', onKill, CAP);
        document.addEventListener('keydown', onKill, CAP);
        document.addEventListener('scroll', onKill, CAP);
        document.addEventListener('viewbeforehide', onKill, true);
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('blur', onKill);
        window.addEventListener('popstate', onKill);
        window.addEventListener('hashchange', onKill);
    }
    function disarm() {
        if (!armed) return;
        armed = false;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerout', onOut, true);
        document.removeEventListener('pointerdown', onKill, true);
        document.removeEventListener('keydown', onKill, true);
        document.removeEventListener('scroll', onKill, true);
        document.removeEventListener('viewbeforehide', onKill, true);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('blur', onKill);
        window.removeEventListener('popstate', onKill);
        window.removeEventListener('hashchange', onKill);
    }

    const start = (card, kind, e) => {
        cur = { el: card, id: card.getAttribute('data-id'), kind };
        mx = e.clientX;
        my = e.clientY;
        arm();
        const s = ++seq;
        timer = setTimeout(() => { timer = 0; load(s); }, Date.now() < warm ? CONFIG.WARM_DELAY_MS : CONFIG.DELAY_MS);
    };

    document.addEventListener('pointerover', e => {
        if (e.pointerType !== 'mouse') return;
        const t = e.target;
        const card = t && t.closest ? t.closest(SEL) : null;
        const id = card ? card.getAttribute('data-id') : null;
        if (cur) {
            if (id === cur.id) { cur.el = card; return; }
            hide(true);
        }
        if (id !== blocked) blocked = null;
        if (!card || blocked) return;
        const kind = kindOf(card);
        if (kind) start(card, kind, e);
    }, { passive: true });
})();
