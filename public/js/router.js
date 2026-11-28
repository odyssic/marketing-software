'use strict';

// ---------------- Router ----------------
async function route() {
  if (/^#\/reset\//.test(location.hash)) return renderAuth('newpass');
  const invite = location.hash.match(/^#\/invite\/([\w-]+)/);
  if (invite) return viewInvite(invite[1]);
  if (!state.me) {
    // Only a real "not signed in" shows the sign-in page. A blip (phone waking up, a slow
    // start, an update going out) is retried quietly, then offers Try again, never a sign-out.
    for (let attempt = 0; !state.me; attempt++) {
      try { state.me = await api('GET', '/api/me'); } catch (e) {
        if (e.message === 'Please sign in') return; // signed out for real; the sign-in page is up
        if (attempt >= 3) return reconnectScreen();
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      }
    }
  }
  // Remember this browser has signed in, so next time it opens on "Welcome back".
  try { localStorage.setItem('rillySignedIn', '1'); } catch { /* private mode */ }
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [section, id] = path.split('/');
  if (state.me.billing?.locked && section !== 'settings') return viewPlanLocked();
  try {
    if (section === 'setup') return viewSetup();
    if (section === 'report') return viewBizReport();
    if (section === 'inbox') return viewInbox(id);
    if (section === 'flows' && id === 'followup') return viewFollowupFlow(path.split('/')[2]);
    if (section === 'flows') return viewFlows();
    if (section === 'blog') return id ? viewBlogPost(id) : viewBlog();
    // Older addresses still work: lists open the matching Flows tab.
    if (section === 'pages' && !id) { location.replace('#/flows'); return; }
    if (section === 'workflows' && !id) { location.replace('#/flows?show=followups'); return; }
    if (['websites', 'members'].includes(section) && !id) { location.replace(`#/flows?show=${section}`); return; }
    if (section === 'funnels' && !id) { location.replace('#/flows?show=pageflows'); return; }
    if (section === 'funnels' && id === 'new') { await viewFlows(); await newFunnel(); }
    else if (section === 'funnels' && id) await viewFunnel(id);
    else if (section === 'funnels') await viewFunnels();
    else if (section === 'editor') await viewEditor(id);
    else if (section === 'pages') await viewPages();
    else if (section === 'people' && id === 'testimonials') await viewTestimonials();
    else if (section === 'websites' && id) await viewFunnel(id); // a website opens as its flow chart
    else if (section === 'websites') await viewWebsites();
    else if (section === 'members' && id) await viewWebsite(id);
    else if (section === 'members') await viewMembersAreas();
    else if (section === 'workflows' && id) await viewWorkflow(id);
    else if (section === 'workflows') await viewWorkflows();
    else if ((section === 'people' || section === 'contacts') && id) await viewPerson(id);
    else if (section === 'people' || section === 'contacts') await viewPeople();
    else if (section === 'pipelines') await viewPipeline(id);
    else if (section === 'products') await viewProducts(id);
    else if (section === 'email' && id === 'print') await viewPrint();
    else if (section === 'email' && id === 'repurpose') viewRepurpose();
    else if (section === 'calendar') await viewCalendar(id);
    else if (section === 'email' && id === 'report') await viewEmailReport(path.split('/')[2]);
    else if (section === 'email' && (id === 'new' || /^\d+$/.test(id || ''))) await viewCompose(id);
    else if (section === 'email') await viewEmail(id);
    else if (section === 'campaigns' && id) await viewCampaign(id);
    else if (section === 'settings' && id === 'developers') await viewDevelopers();
    else if (section === 'settings') viewSettings();
    else if (section === 'analytics') await viewAnalytics();
    else await viewDashboard();
  } catch (err) {
    if (state.me) shell(section, `<div class="card empty"><div class="big">${icon('alert')}</div><h2>${esc(err.message)}</h2><a href="#/">Back to dashboard</a></div>`);
  }
}

window.addEventListener('hashchange', route);
route();

// Couldn't reach Rilly (offline or a hiccup): you're still signed in; try again when ready.
function reconnectScreen() {
  app.innerHTML = `<div class="reconnect"><h1>Can’t reach Rilly right now</h1><p class="muted">You’re still signed in. Check your connection, then try again.</p>
    <button class="btn primary" data-retry>Try again</button></div>`;
  $('[data-retry]').onclick = () => route();
  addEventListener('online', () => { if ($('.reconnect')) route(); }, { once: true });
}
