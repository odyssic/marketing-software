'use strict';

// ---------------- Router ----------------
async function route() {
  if (!state.me) {
    try { state.me = await api('GET', '/api/me'); } catch { return renderAuth(); }
  }
  const [path] = location.hash.replace(/^#\/?/, '').split('?');
  const [section, id] = path.split('/');
  try {
    if (section === 'funnels' && id === 'new') { await viewFunnels(); await newFunnel(); }
    else if (section === 'funnels' && id) await viewFunnel(id);
    else if (section === 'funnels') await viewFunnels();
    else if (section === 'editor') await viewEditor(id);
    else if (section === 'workflows' && id) await viewWorkflow(id);
    else if (section === 'workflows') await viewWorkflows();
    else if ((section === 'people' || section === 'contacts') && id) await viewPerson(id);
    else if (section === 'people' || section === 'contacts') await viewPeople();
    else if (section === 'pipelines') await viewPipeline(id);
    else if (section === 'products') await viewProducts(id);
    else if (section === 'email' && id === 'print') await viewPrint();
    else if (section === 'email' && id === 'repurpose') viewRepurpose();
    else if (section === 'email') await viewEmail(id);
    else if (section === 'campaigns' && id) await viewCampaign(id);
    else if (section === 'settings') viewSettings();
    else await viewDashboard();
  } catch (err) {
    if (state.me) shell(section, `<div class="card empty"><div class="big">⚠️</div><h2>${esc(err.message)}</h2><a href="#/">Back to dashboard</a></div>`);
  }
}

window.addEventListener('hashchange', route);
route();
