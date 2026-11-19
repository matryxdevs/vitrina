/* Vitrina Marketplace - interface do cliente; toda autorização é validada no servidor. */
const REGIONS={
  Norte:['AC','AP','AM','PA','RO','RR','TO'],
  Nordeste:['AL','BA','CE','MA','PB','PE','PI','RN','SE'],
  'Centro-Oeste':['DF','GO','MT','MS'],
  Sudeste:['ES','MG','RJ','SP'],
  Sul:['PR','RS','SC']
};
const CATEGORIES=['Eletrônicos','Veículos','Imóveis','Casa e móveis','Eletrodomésticos','Ferramentas','Moda','Esporte e lazer','Serviços','Empregos','Outros'];
const ICONS={'Eletrônicos':'⌁','Veículos':'▱','Imóveis':'⌂','Casa e móveis':'▦','Eletrodomésticos':'✤','Ferramentas':'⚒','Moda':'✺','Esporte e lazer':'◉','Serviços':'✧','Empregos':'▤','Outros':'✳'};
const state={user:null,configured:false,listings:[],selectedConversation:null,startListingId:null,poll:null,activeAuth:'login',page:1,hasMore:false,adminTab:'promotions'};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escapeHtml=(s)=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=s=>s?new Date(String(s).replace(' ','T')+'Z').toLocaleDateString('pt-BR'):'';
const avatar=(name,img='')=>`<span class="avatar">${img?`<img src="${escapeHtml(img)}" alt="">`:escapeHtml((name||'?').charAt(0).toUpperCase())}</span>`;
const photo=(listing)=>listing.image?`<img src="${escapeHtml(listing.image)}" alt="Foto do anúncio">`:`<span class="fallback-icon">${ICONS[listing.category]||'✳'}</span>`;
let toastTimer;
function toast(message,bad=false){const el=$('#toast');el.textContent=message;el.classList.toggle('err',bad);el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4000);}
async function api(method,url,data){
  const options={method,credentials:'same-origin',headers:{}};
  if(data!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
  const r=await fetch(url,options);
  const result=await r.json().catch(()=>({error:'Não foi possível processar a resposta.'}));
  if(!r.ok)throw new Error(result.error||`Erro ${r.status}`);
  return result;
}
function modal(html,wide=false){clearInterval(state.poll);state.poll=null;$('#modalBody').innerHTML=html;$('#modalLayer').hidden=false;$('#modalLayer').classList.toggle('large-modal',wide);document.body.style.overflow='hidden';const first=$('#modalBody input:not([type=file])');if(first) setTimeout(()=>first.focus(),35);}
function closeModal(){clearInterval(state.poll);state.poll=null;state.selectedConversation=null;$('#modalLayer').hidden=true;document.body.style.overflow='';}
function selectRegion(id,selected=''){return `<select class="form-select" id="${id}Region" name="region" data-location-region="${id}" required><option value="">Selecione a região</option>${Object.keys(REGIONS).map(x=>`<option value="${x}" ${x===selected?'selected':''}>${x}</option>`).join('')}</select>`;}
function selectState(id,region='',selected=''){return `<select class="form-select" id="${id}State" name="state" data-location-state="${id}" required><option value="">Selecione o estado</option>${(REGIONS[region]||[]).map(x=>`<option value="${x}" ${x===selected?'selected':''}>${x}</option>`).join('')}</select>`;}
function locationForm(id,user={}){return `<div class="form-grid"><div class="form-group"><label>Região</label>${selectRegion(id,user.region)}</div><div class="form-group"><label>Estado (UF)</label>${selectState(id,user.region,user.state)}</div></div><div class="form-group"><label for="${id}City">Cidade</label><input class="form-input" id="${id}City" name="city" list="${id}Cities" required maxlength="90" value="${escapeHtml(user.city||'')}" placeholder="Digite ou escolha sua cidade"><datalist id="${id}Cities"></datalist></div>`;}
async function fetchCities(uf,datalistId){
  const list=document.getElementById(datalistId);if(!list||!uf)return;
  list.innerHTML='';
  try {
    const r=await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`,{signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw Error();const cities=await r.json();
    if(document.getElementById(datalistId)===list)list.innerHTML=cities.map(c=>`<option value="${escapeHtml(c.nome)}"></option>`).join('');
  }catch { /* A digitação manual continua funcionando se o IBGE estiver indisponível. */ }
}
function inputData(form){return Object.fromEntries(new FormData(form).entries());}
function updateNav(){
  $('#accountNav').textContent=state.user?`Olá, ${state.user.name.split(' ')[0]}`:'Entrar';
  $('#chatNav').title=state.user?'Minhas conversas':'Entre para acessar o chat';
}
async function loadPromotions(){
  try{
    const {promotions}=await api('GET','/api/promotions');
    $('#sitePromotions').hidden=!promotions.length;
    $('#promotionsGrid').innerHTML=promotions.map(p=>`<article class="promo-card">${p.image?`<img class="promo-image" src="${escapeHtml(p.image)}" alt="Imagem da campanha">`:''}<div class="promo-copy"><div class="kicker">COMUNICADO EM DESTAQUE</div><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.body)}</p>${p.target_url?`<a class="btn btn-yellow" href="${escapeHtml(p.target_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.button_label||'Saiba mais')} ↗</a>`:''}</div></article>`).join('');
  }catch(e){console.warn('Campanhas temporariamente indisponíveis.',e.message);}
}
function renderListings(){
  $('#resultCount').textContent=`${state.listings.length} ${state.listings.length===1?'anúncio encontrado':'anúncios encontrados'}`;
  $('#emptyState').hidden=state.listings.length>0;
  $('#moreListings').hidden=!state.hasMore;
  $('#listingGrid').innerHTML=state.listings.map(l=>`<article class="listing-card" tabindex="0" role="button" data-action="detail" data-id="${l.id}" aria-label="Ver anúncio ${escapeHtml(l.title)}"><div class="listing-photo">${photo(l)}<span class="tag">${escapeHtml(l.category)}</span></div><div class="listing-meta"><h3>${escapeHtml(l.title)}</h3><div class="listing-price">${money(l.price)}</div><div class="listing-card-bottom"><span>⌖ ${escapeHtml(l.city)} · ${escapeHtml(l.state)}</span><span>VER DETALHES ↗</span></div></div></article>`).join('');
}
async function loadListings(more=false){
  if(!more)state.page=1;
  const q=new URLSearchParams();
  q.set('page',String(state.page));
  const fields={region:'#regionFilter',state:'#stateFilter',city:'#cityFilter',category:'#categoryFilter',search:'#searchInput'};
  for(const [k,v] of Object.entries(fields)){const input=$(v);if(input?.value.trim())q.set(k,input.value.trim());}
  try{const r=await api('GET','/api/listings?'+q);state.listings=more?[...state.listings,...r.listings]:r.listings;state.hasMore=!!r.pagination?.hasMore;renderListings();}catch(e){toast(e.message,true);}
}
function initFilters(){
  const region=$('#regionFilter'), uf=$('#stateFilter');
  region.addEventListener('change',()=>{
    uf.innerHTML='<option value="">Todos os estados</option>'+(REGIONS[region.value]||Object.values(REGIONS).flat()).map(x=>`<option>${x}</option>`).join('');
    $('#cityFilter').value='';$('#filterCities').innerHTML='';
  });
  uf.innerHTML='<option value="">Todos os estados</option>'+Object.values(REGIONS).flat().sort().map(x=>`<option>${x}</option>`).join('');
  uf.addEventListener('change',()=>{if(uf.value){region.value=Object.entries(REGIONS).find(([_,states])=>states.includes(uf.value))?.[0]||'';fetchCities(uf.value,'filterCities');}$('#cityFilter').value='';});
  $('#applyFilters').addEventListener('click',()=>loadListings());
  $('#moreListings').addEventListener('click',()=>{state.page++;loadListings(true);});
  $('#clearFilters').addEventListener('click',()=>{region.value='';uf.innerHTML='<option value="">Todos os estados</option>'+Object.values(REGIONS).flat().sort().map(x=>`<option>${x}</option>`).join('');uf.value='';$('#cityFilter').value='';$('#categoryFilter').value='';$('#searchInput').value='';loadListings();});
  $('#searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')loadListings();});
  $$('#categoryRow [data-cat]').forEach(el=>el.addEventListener('click',()=>{$('#categoryFilter').value=el.dataset.cat;document.querySelector('#explorar').scrollIntoView({behavior:'smooth'});loadListings();}));
}
function authModal(mode='login'){
  state.activeAuth=mode;
  modal(`<div class="modal-kicker">BEM-VINDO À VITRINA</div><h2 class="modal-title">${mode==='login'?'Que bom ter você de volta.':'Entre para a comunidade.'}</h2><p class="modal-subtitle">Sua conexão com as melhores oportunidades começa aqui.</p>
    <div class="auth-switch"><button class="${mode==='login'?'current':''}" data-action="loginTab">Entrar</button><button class="${mode==='register'?'current':''}" data-action="registerTab">Criar conta</button></div>
    ${mode==='login'?`<form id="loginForm" class="form-stack"><div class="form-group"><label>E-mail</label><input class="form-input" name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></div><div class="form-group"><label>Senha</label><input class="form-input" name="password" type="password" autocomplete="current-password" required></div><button class="btn btn-yellow form-submit">Entrar na plataforma ↗</button></form>`:
    `<form id="registerForm" class="form-stack"><div class="form-grid"><div class="form-group"><label>Nome para exibição</label><input class="form-input" name="name" required maxlength="80" placeholder="Seu nome"></div><div class="form-group"><label>Idade (18+)</label><input class="form-input" name="age" type="number" min="18" max="110" required placeholder="Ex.: 25"></div></div><div class="form-grid"><div class="form-group"><label>E-mail</label><input class="form-input" name="email" type="email" autocomplete="email" required placeholder="voce@exemplo.com"></div><div class="form-group"><label>Senha (12+ caracteres)</label><input class="form-input" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div></div>${locationForm('reg')}<div class="form-group"><label>WhatsApp com DDD</label><input class="form-input" name="whatsapp" inputmode="tel" placeholder="(94) 99999-9999" required maxlength="22"><small>Visível apenas para você e para a administração da plataforma.</small></div><div class="private-alert">🔒 Seu número de WhatsApp é privado e não será exibido a compradores ou vendedores.</div><button class="btn btn-yellow form-submit">Criar conta gratuita ↗</button></form>`}`);
}
async function accountModal(){
  if(!state.user)return authModal('login');
  const u=state.user;
  modal(`<div class="modal-kicker">MINHA CONTA</div><h2 class="modal-title">Olá, ${escapeHtml(u.name.split(' ')[0])}.</h2><p class="modal-subtitle">Gerencie seu perfil, anúncios e conversas em um só lugar.</p>
    <div class="seller-box" style="border:0;margin:0;padding:0 0 24px">${avatar(u.name,u.avatar)}<div><b>${escapeHtml(u.name)}</b><small>⌖ ${escapeHtml(u.city)} · ${escapeHtml(u.state)} · ${u.age} anos</small></div></div>
    <div class="mini-list"><button class="btn btn-outline" data-action="editProfile">✎ Editar perfil</button><button class="btn btn-outline" data-action="myListings">▦ Meus anúncios</button><button class="btn btn-outline" data-action="inbox">☏ Minhas conversas</button>${u.role==='admin'?`<button class="btn btn-outline" data-action="admin">✳ Painel administrativo</button>`:''}<button class="btn btn-outline" data-action="logout">Sair da conta</button></div>`);
}
function profileModal(){
  const u=state.user;if(!u)return authModal('login');
  modal(`<div class="modal-kicker">MEU PERFIL</div><h2 class="modal-title">Suas informações</h2><p class="modal-subtitle">Nome, idade, foto e localização aparecem publicamente. Seu WhatsApp permanece reservado.</p>
    <form id="profileForm" class="form-stack"><div class="image-upload"><div class="image-preview" id="avatarPreview">${u.avatar?`<img src="${escapeHtml(u.avatar)}" alt="Foto atual">`:'◉'}</div><div class="form-group"><label>Foto de perfil</label><input id="avatarFile" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG ou WebP · máximo 1,2 MB</small></div></div>
    <div class="form-grid"><div class="form-group"><label>Nome</label><input name="name" class="form-input" value="${escapeHtml(u.name)}" maxlength="80" required></div><div class="form-group"><label>Idade</label><input name="age" type="number" min="18" max="110" class="form-input" value="${u.age}" required></div></div>${locationForm('profile',u)}<div class="form-group"><label>WhatsApp (privado)</label><input name="whatsapp" class="form-input" value="${escapeHtml(u.whatsapp)}" required></div><div class="private-alert">🔒 Seu número é disponibilizado apenas na sua conta e ao administrador.</div><button class="btn btn-yellow form-submit">Salvar alterações ↗</button></form>`);
  fetchCities(u.state,'profileCities');
}
async function fileData(input,limit){
  const file=input?.files?.[0];if(!file)return undefined;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>limit)throw new Error('Envie uma imagem JPG, PNG ou WebP dentro do limite informado.');
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Falha na leitura da imagem.'));reader.readAsDataURL(file);});
}
function publishModal(){
  if(!state.user){toast('Crie uma conta ou entre para anunciar.');return authModal('register');}
  if(!state.user.can_post)return toast('Sua conta não tem permissão para anunciar. Contate o administrador.',true);
  modal(`<div class="modal-kicker">PUBLICAR ANÚNCIO</div><h2 class="modal-title">Mostre sua oferta ao mundo. <span style="color:var(--yellow)">Por R$ 5.</span></h2><p class="modal-subtitle">O anúncio será publicado somente após a confirmação do pagamento.</p>
  <form id="publishForm" class="form-stack"><div class="form-group"><label>Título do anúncio</label><input class="form-input" name="title" required minlength="5" maxlength="110" placeholder="Ex.: Bicicleta aro 29 em ótimo estado"></div><div class="form-grid"><div class="form-group"><label>Categoria do objeto <b style="color:var(--yellow)">*</b></label><select class="form-select" name="category" required><option value="" selected disabled>Selecione obrigatoriamente</option>${CATEGORIES.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="form-group"><label>Preço do produto (R$)</label><input class="form-input" name="price" type="number" min="0" max="100000000" step="0.01" required placeholder="Ex.: 350.00"></div></div><div class="form-group"><label>Descrição</label><textarea class="form-textarea" name="description" minlength="15" maxlength="2500" required placeholder="Descreva o estado, detalhes importantes e condições de venda..."></textarea></div><div class="form-group"><label>Foto do anúncio (opcional)</label><input id="listingFile" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG ou WebP, até 3 MB</small></div><div class="private-alert">⌖ Local do anúncio: <b>${escapeHtml(state.user.city)} · ${escapeHtml(state.user.state)}</b>. Para alterar, atualize seu perfil.</div><div class="private-alert">💳 Taxa única por anúncio: <b>R$ 5,00</b>. Pagamento via Mercado Pago em ambiente seguro.</div><button class="btn btn-yellow form-submit">Continuar para pagamento — R$ 5 ↗</button></form>`);
}
async function myListings(){
  if(!state.user)return authModal('login');
  try{
    const r=await api('GET','/api/listings/mine');
    modal(`<div class="modal-kicker">MINHA VITRINE</div><h2 class="modal-title">Meus anúncios</h2><p class="modal-subtitle">Cada novo anúncio exige um pagamento independente de R$ 5.</p>
    <div class="mini-list">${r.listings.length?r.listings.map(x=>`<div class="mini-item"><div class="mini-item-info"><b>${escapeHtml(x.title)}</b><small>${money(x.price)} · ${date(x.created_at)}</small><span class="pill ${x.status==='active'?'active':x.status==='draft'?'draft':''}">${{active:'Publicado',draft:'Aguardando pagamento',hidden:'Ocultado',removed:'Removido'}[x.status]||'Pendente'}</span></div><div class="mini-actions">${x.status==='draft'?`<button class="btn-mini primary" data-action="pay" data-id="${x.id}">Pagar R$ 5</button><button class="btn-mini" data-action="checkPayment" data-id="${x.id}">Verificar</button>`:''}${x.status!=='removed'?`<button class="btn-mini warn" data-action="removeListing" data-id="${x.id}">Remover</button>`:''}</div></div>`).join(''):'<div class="empty-mini">Você ainda não criou anúncios. Que tal publicar o primeiro?</div>'}</div><button class="btn btn-yellow form-submit" data-action="publish">＋ Criar novo anúncio</button>`);
  }catch(e){toast(e.message,true);}
}
async function beginPayment(id){
  try{toast('Abrindo pagamento seguro...');const r=await api('POST',`/api/listings/${id}/checkout`,{});if(!/^https:\/\//.test(r.checkoutUrl))throw new Error('URL de pagamento inválida.');window.location.assign(r.checkoutUrl);}catch(e){toast(e.message,true);}
}
async function checkPayment(id){
  try{const r=await api('POST',`/api/listings/${id}/check-payment`,{});toast(r.status==='active'?'Pagamento confirmado! Anúncio publicado.':'Pagamento ainda não confirmado.');myListings();loadListings();}catch(e){toast(e.message,true);}
}
async function listingDetail(id){
  try{
    const {listing:l}=await api('GET',`/api/listings/${id}`);
    state.startListingId=l.id;
    modal(`<div class="detail-image">${photo(l)}</div><div class="detail-topline"><span class="pill">${escapeHtml(l.category)}</span><span>⌖ ${escapeHtml(l.city)} · ${escapeHtml(l.state)}</span><span>${date(l.created_at)}</span></div>
    <h2 class="modal-title">${escapeHtml(l.title)}</h2><div class="detail-price">${money(l.price)}</div><p class="detail-description">${escapeHtml(l.description)}</p>
    <div class="seller-box">${avatar(l.seller_name,l.seller_avatar)}<div><b>${escapeHtml(l.seller_name)}</b><small>${Number(l.seller_age)} anos · ${escapeHtml(l.city)} / ${escapeHtml(l.state)}</small></div><button class="btn-mini" data-action="seller" data-id="${l.user_id}">Ver perfil</button></div>
    ${l.user_id!==state.user?.id?`<form id="chatStartForm" class="form-stack" style="margin-top:18px"><div class="form-group"><label>Mensagem para o vendedor</label><textarea class="form-textarea" name="text" maxlength="1000" required placeholder="Olá, tenho interesse neste anúncio. Está disponível?"></textarea></div><button class="btn btn-yellow form-submit">✉ Conversar pelo chat interno</button></form>`:`<div class="payment-notice">Este anúncio pertence a você.</div>`}
    ${l.user_id!==state.user?.id?`<button class="btn-mini warn" data-action="report" data-id="${l.id}" style="margin-top:13px">⚑ Denunciar este anúncio</button>`:''}
    <p class="security-note">A Vitrina não compartilha telefones entre usuários. Evite enviar documentos ou dados bancários no chat.</p>`);
  }catch(e){toast(e.message,true);}
}
async function sellerProfile(id){
  try{const {user:u}=await api('GET',`/api/users/${id}`);modal(`<div class="modal-kicker">PERFIL PÚBLICO</div><h2 class="modal-title">Conheça o anunciante.</h2><div class="seller-box" style="border:0;padding:5px 0 15px;margin:0">${avatar(u.name,u.avatar)}<div><b>${escapeHtml(u.name)}</b><small>${u.age} anos · ${escapeHtml(u.city)} / ${escapeHtml(u.state)}</small></div></div><div class="private-alert">🔒 O telefone e o e-mail do usuário são privados. Para entrar em contato, abra um anúncio e utilize o chat interno.</div><button class="btn btn-outline form-submit" data-action="close">Voltar à vitrina</button>`);}catch(e){toast(e.message,true);}
}
async function inbox(chosen){
  if(!state.user)return authModal('login');
  try{
    const r=await api('GET','/api/chat/conversations');
    const active=chosen||r.conversations[0]?.id;
    state.selectedConversation=active||null;
    modal(`<div class="modal-kicker">MENSAGENS</div><h2 class="modal-title">Seu chat na Vitrina</h2><p class="modal-subtitle">Negocie diretamente, sem precisar expor o WhatsApp.</p>${r.conversations.length?`<div class="chat-layout"><div class="thread-list">${r.conversations.map(c=>`<button class="thread-btn ${c.id===active?'current':''}" data-action="thread" data-id="${c.id}"><b>${escapeHtml(c.partner_name)}</b><small>${escapeHtml(c.listing_title)}</small><small>${escapeHtml(c.last_message||'')}</small></button>`).join('')}</div><div class="chat-pane"><div id="chatMessages" class="chat-messages" aria-live="polite"></div><form id="chatReplyForm" class="chat-form"><input name="text" placeholder="Escreva uma mensagem..." maxlength="1000" autocomplete="off" required><button class="btn btn-yellow">Enviar ↗</button></form></div></div>`:'<div class="empty-mini">Você ainda não tem conversas. Abra um anúncio e envie a primeira mensagem.</div>'}`,true);
    state.selectedConversation=active||null;
    if(active){await loadMessages();state.poll=setInterval(loadMessages,3000);}
  }catch(e){toast(e.message,true);}
}
async function loadMessages(){
  const id=state.selectedConversation, container=$('#chatMessages');if(!id||!container)return;
  try{const r=await api('GET',`/api/chat/${id}/messages`);if(state.selectedConversation!==id)return;
    const atBottom=container.scrollHeight-container.scrollTop-container.clientHeight<90;
    const markup=r.messages.map(m=>`<div class="bubble ${m.sender_id===state.user.id?'mine':''}">${escapeHtml(m.text)}<small>${escapeHtml(m.sender_name)} · ${date(m.created_at)}</small></div>`).join('');
    if(container.innerHTML!==markup){container.innerHTML=markup;if(atBottom||!container.dataset.loaded)container.scrollTop=container.scrollHeight;container.dataset.loaded='1';}
  }catch{/* Não exibe uma mensagem por falha temporária de atualização do chat. */}
}
async function adminPanel(){
  if(state.user?.role!=='admin')return;
  try{
    const [dashboard,users,listings,reports,promotions,auditData,payments]=await Promise.all([
      api('GET','/api/admin/dashboard'),api('GET','/api/admin/users'),api('GET','/api/admin/listings'),
      api('GET','/api/admin/reports'),api('GET','/api/admin/promotions'),api('GET','/api/admin/audit'),api('GET','/api/admin/payments')]);
    const st=dashboard.stats;
    modal(`<div class="modal-kicker">VITRINA / CENTRO DE CONTROLE</div><h2 class="modal-title">Painel administrativo</h2><p class="modal-subtitle">Gerencie campanhas públicas, usuários, anunciantes, anúncios e denúncias. Ações administrativas são registradas.</p>
      <div class="admin-stats">
        <div><b>${st.users_total}</b><small>Usuários</small></div><div><b>${st.sellers_total}</b><small>Anunciantes</small></div>
        <div><b>${st.active_listings}</b><small>Publicados</small></div><div><b>${st.pending_listings}</b><small>Rascunhos</small></div>
        <div><b>${st.active_promotions}</b><small>Propagandas</small></div><div><b>${st.blocked_total}</b><small>Bloqueados</small></div>
      </div>
      <div class="admin-tabs" role="tablist" aria-label="Seções da administração">
        <button class="is-selected" data-action="adminTab" data-section="promotions">Propagandas</button>
        <button data-action="adminTab" data-section="users">Usuários</button>
        <button data-action="adminTab" data-section="listings">Anúncios</button>
        <button data-action="adminTab" data-section="reports">Denúncias</button>
        <button data-action="adminTab" data-section="payments">Pagamentos</button>
        <button data-action="adminTab" data-section="audit">Auditoria</button>
      </div>
      <section id="adm-promotions" class="admin-section">
        <h3>Criar campanha para todos os visitantes</h3><p class="admin-help">O banner aparece na página inicial para visitantes logados e não logados. É gratuito para o administrador e independente dos anúncios de R$ 5.</p>
        <form id="promotionForm" class="form-stack admin-promotion-form">
          <div class="form-group"><label>Título da propaganda *</label><input class="form-input" name="title" required minlength="4" maxlength="100" placeholder="Ex.: Semana de ofertas na Vitrina"></div>
          <div class="form-group"><label>Mensagem da campanha *</label><textarea class="form-textarea" name="body" required minlength="10" maxlength="500" placeholder="Escreva o comunicado que todos verão..."></textarea></div>
          <div class="form-grid"><div class="form-group"><label>Texto do botão</label><input class="form-input" name="button_label" maxlength="35" placeholder="Saiba mais"></div>
          <div class="form-group"><label>Prioridade de exibição</label><select class="form-select" name="priority"><option value="3">Normal</option><option value="5">Máxima</option><option value="1">Baixa</option></select></div></div>
          <div class="form-group"><label>Link de destino (opcional, HTTPS)</label><input class="form-input" name="target_url" type="url" placeholder="https://seudominio.com/pagina"></div>
          <div class="form-group"><label>Imagem da propaganda (opcional)</label><input type="file" id="promoFile" accept="image/jpeg,image/png,image/webp"><small>Até 3 MB, JPG, PNG ou WebP</small></div>
          <button class="btn btn-yellow form-submit">✳ Publicar propaganda para todos</button>
        </form>
        <h3>Campanhas cadastradas (${promotions.promotions.length})</h3>
        <div class="mini-list">${promotions.promotions.map(p=>`<div class="mini-item"><div class="mini-item-info"><b>${escapeHtml(p.title)}</b><small>${date(p.created_at)} · Prioridade ${p.priority}</small><span class="pill ${p.status==='active'?'active':''}">${p.status==='active'?'Em exibição':'Pausada'}</span></div><div class="mini-actions"><button class="btn-mini" data-action="adminPromotion" data-id="${p.id}" data-value="${p.status==='active'?'paused':'active'}">${p.status==='active'?'Pausar':'Reativar'}</button><button class="btn-mini warn" data-action="adminDeletePromo" data-id="${p.id}">Excluir</button></div></div>`).join('')||'<div class="empty-mini">Ainda não há campanhas.</div>'}</div>
      </section>
      <section id="adm-users" class="admin-section" hidden>
        <h3>Usuários e anunciantes (${users.users.length})</h3><p class="admin-help">O WhatsApp é privado: acessível exclusivamente ao titular e ao administrador. Suspender uma conta encerra sessões e oculta seus anúncios públicos. Reativar não republica anúncios automaticamente.</p>
        <div class="admin-users">${users.users.map(x=>`<div class="admin-user"><div class="admin-user-header">${avatar(x.name,x.avatar)}<div><b>${escapeHtml(x.name)}</b><small>${escapeHtml(x.email)} · ${escapeHtml(x.city)}/${escapeHtml(x.state)}</small><small>WhatsApp privado: ${escapeHtml(x.whatsapp)}</small><small>${x.total_listings} anúncios · ${escapeHtml(x.role)} · ${escapeHtml(x.account_status)}</small></div></div>
          ${x.role==='admin'?`<span class="pill">Administrador protegido</span>`:
            `<div class="admin-user-controls"><label>Status da conta<select class="form-select" data-admin-user="${x.id}" data-key="account_status"><option value="active" ${x.account_status==='active'?'selected':''}>Ativa</option><option value="suspended" ${x.account_status==='suspended'?'selected':''}>Suspensa</option><option value="banned" ${x.account_status==='banned'?'selected':''}>Bloqueada</option></select></label>
            <label>Tipo<select class="form-select" data-admin-user="${x.id}" data-key="role"><option value="user" ${x.role==='user'?'selected':''}>Usuário comum</option><option value="seller" ${x.role==='seller'?'selected':''}>Anunciante</option></select></label>
            <label>Permissão para publicar<select class="form-select" data-admin-user="${x.id}" data-key="can_post"><option value="true" ${x.can_post?'selected':''}>Permitido</option><option value="false" ${!x.can_post?'selected':''}>Bloqueado</option></select></label></div>`}</div>`).join('')}</div>
      </section>
      <section id="adm-listings" class="admin-section" hidden><h3>Moderação de anúncios (${listings.listings.length})</h3>
        <div class="mini-list">${listings.listings.map(l=>`<div class="mini-item"><div class="mini-item-info"><b>${escapeHtml(l.title)}</b><small>${escapeHtml(l.category)} · ${escapeHtml(l.seller_name)} · ${money(l.price_cents/100)}</small><span class="pill ${l.status==='active'?'active':l.status==='draft'?'draft':''}">${escapeHtml(l.status)}</span></div><div class="mini-actions">${l.status==='active'?`<button class="btn-mini warn" data-action="adminListing" data-value="hide" data-id="${l.id}">Ocultar</button>`:''}${l.status==='hidden'?`<button class="btn-mini primary" data-action="adminListing" data-value="restore" data-id="${l.id}">Restaurar (pago)</button>`:''}${l.status!=='removed'?`<button class="btn-mini warn" data-action="adminListing" data-value="remove" data-id="${l.id}">Remover</button>`:''}</div></div>`).join('')||'<div class="empty-mini">Ainda não há anúncios.</div>'}</div>
      </section>
      <section id="adm-reports" class="admin-section" hidden><h3>Denúncias (${reports.reports.length})</h3>
        <div class="mini-list">${reports.reports.map(r=>`<div class="mini-item"><div class="mini-item-info"><b>${escapeHtml(r.listing_title)}</b><small>Enviada por ${escapeHtml(r.reporter_name)} · ${date(r.created_at)}</small><p>${escapeHtml(r.reason)}</p></div><button class="btn-mini warn" data-action="adminListing" data-value="hide" data-id="${r.listing_id}">Ocultar</button></div>`).join('')||'<div class="empty-mini">Nenhuma denúncia recebida.</div>'}</div>
      </section>
      <section id="adm-payments" class="admin-section" hidden><h3>Pagamentos por anúncio (${payments.payments.length})</h3><p class="admin-help">Valor bruto de cada cobrança processada: R$ 5,00. Tarifas, estornos, conciliação e recebimento líquido devem ser conferidos também no Mercado Pago.</p>
        <div class="table-scroll"><table class="admin-table"><thead><tr><th>Quando</th><th>Anunciante</th><th>Anúncio</th><th>Situação</th><th>Identificador</th></tr></thead><tbody>${payments.payments.map(p=>`<tr><td>${date(p.created_at)}</td><td>${escapeHtml(p.seller_name)}</td><td>${escapeHtml(p.listing_title)}</td><td>${escapeHtml(p.status)}</td><td>${escapeHtml(p.mp_order_id)}</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section id="adm-audit" class="admin-section" hidden><h3>Histórico de ações (${auditData.logs.length})</h3>
        <div class="table-scroll"><table class="admin-table"><thead><tr><th>Quando</th><th>Responsável</th><th>Ação</th><th>Alvo</th></tr></thead><tbody>${auditData.logs.map(a=>`<tr><td>${date(a.created_at)}</td><td>${escapeHtml(a.admin_name)}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.target_type)} / ${escapeHtml(a.target_id.slice(0,8))}</td></tr>`).join('')}</tbody></table></div>
      </section>`,true);
    $$('.admin-section').forEach(n=>n.hidden=n.id!==`adm-${state.adminTab}`);
    $$('.admin-tabs button').forEach(n=>n.classList.toggle('is-selected',n.dataset.section===state.adminTab));
  }catch(e){toast(e.message,true);}
}
async function refreshSession(){try{const r=await api('GET','/api/me');state.user=r.user;state.configured=r.configured;updateNav();}catch{state.user=null;updateNav();}}
function onClick(e){
  if(e.target.closest('[data-cat]'))return;
  const el=e.target.closest('[data-action]');if(!el)return;
  const action=el.dataset.action,id=el.dataset.id;
  if(action==='close')return closeModal();
  if(action==='publish')return publishModal();
  if(action==='account')return accountModal();
  if(action==='inbox')return inbox();
  if(action==='loginTab')return authModal('login');
  if(action==='registerTab')return authModal('register');
  if(action==='editProfile')return profileModal();
  if(action==='myListings')return myListings();
  if(action==='detail')return listingDetail(id);
  if(action==='seller')return sellerProfile(id);
  if(action==='pay')return beginPayment(id);
  if(action==='checkPayment')return checkPayment(id);
  if(action==='thread')return inbox(id);
  if(action==='admin')return adminPanel();
  if(action==='adminTab'){
    state.adminTab=el.dataset.section;
    $$('.admin-section').forEach(n=>n.hidden=n.id!==`adm-${el.dataset.section}`);
    $$('.admin-tabs button').forEach(n=>n.classList.toggle('is-selected',n===el));
    return;
  }
  if(action==='adminListing'){
    const v=el.dataset.value;
    if(v==='remove'&&!confirm('Remover este anúncio permanentemente da vitrine?'))return;
    return api('POST',`/api/admin/listings/${id}/${v}`,{}).then(()=>{toast('Anúncio atualizado.');adminPanel();loadListings();}).catch(e=>toast(e.message,true));
  }
  if(action==='adminPromotion'){
    return api('PATCH',`/api/admin/promotions/${id}`,{status:el.dataset.value}).then(()=>{toast('Campanha atualizada.');adminPanel();loadPromotions();}).catch(e=>toast(e.message,true));
  }
  if(action==='adminDeletePromo'){
    if(!confirm('Excluir esta campanha?'))return;
    return api('DELETE',`/api/admin/promotions/${id}`,{}).then(()=>{toast('Campanha excluída.');adminPanel();loadPromotions();}).catch(e=>toast(e.message,true));
  }
  if(action==='report'){
    if(!state.user)return authModal('login');
    const reason=prompt('Descreva o motivo da denúncia (fraude, conteúdo inadequado etc.):');
    if(reason===null)return;
    return api('POST',`/api/listings/${id}/report`,{reason}).then(()=>toast('Denúncia enviada para análise da administração.')).catch(e=>toast(e.message,true));
  }
  if(action==='logout')return api('POST','/api/logout',{}).then(()=>{state.user=null;updateNav();closeModal();toast('Você saiu da conta.');}).catch(e=>toast(e.message,true));
  if(action==='removeListing'){
    if(!confirm('Remover este anúncio? A cobrança realizada não será automaticamente reembolsada.'))return;
    return api('DELETE',`/api/listings/${id}`).then(()=>{toast('Anúncio removido.');myListings();loadListings();}).catch(e=>toast(e.message,true));
  }
  if(action==='adminHide')return api('POST',`/api/admin/listings/${id}/hide`,{}).then(()=>{toast('Anúncio ocultado.');adminPanel();loadListings();}).catch(e=>toast(e.message,true));
}
async function onSubmit(e){
  const form=e.target;if(!form.matches('form'))return;e.preventDefault();
  const button=form.querySelector('button[type=submit],button:not([type])');
  if(button){button.disabled=true;button.dataset.original=button.textContent;button.textContent='Processando...';}
  try{
    const data=inputData(form);
    if(form.id==='loginForm'){
      const r=await api('POST','/api/login',data);state.user=r.user;updateNav();closeModal();toast('Bem-vindo de volta!');
    }else if(form.id==='registerForm'){
      data.age=Number(data.age);const r=await api('POST','/api/register',data);state.user=r.user;updateNav();closeModal();toast('Conta criada! Você já pode anunciar.');
    }else if(form.id==='profileForm'){
      data.age=Number(data.age);data.avatarData=await fileData($('#avatarFile'),1_200_000);
      const r=await api('PATCH','/api/me',data);state.user=r.user;updateNav();accountModal();toast('Perfil atualizado com sucesso.');
    }else if(form.id==='publishForm'){
      data.imageData=await fileData($('#listingFile'),3_000_000);
      const r=await api('POST','/api/listings',data);
      toast('Rascunho criado. Iniciando cobrança de R$ 5...');
      await beginPayment(r.id);
    }else if(form.id==='chatStartForm'){
      if(!state.user){toast('Entre para conversar com o vendedor.');return authModal('login');}
      const r=await api('POST','/api/chat/start',{listingId:state.startListingId,text:data.text});toast('Mensagem enviada com sucesso.');await inbox(r.conversationId);
    }else if(form.id==='heroSearchForm'){
      $('#searchInput').value=data.search?.trim()||'';
      $('#categoryFilter').value=data.category||'';
      document.querySelector('#explorar').scrollIntoView({behavior:'smooth'});
      await loadListings();
    }else if(form.id==='promotionForm'){
      data.imageData=await fileData($('#promoFile'),3_000_000);
      data.priority=Number(data.priority||3);
      await api('POST','/api/admin/promotions',data);
      toast('Campanha publicada para todos os visitantes.');
      await adminPanel();await loadPromotions();
    }else if(form.id==='chatReplyForm'){
      await api('POST',`/api/chat/${state.selectedConversation}/messages`,{text:data.text});form.reset();await loadMessages();
    }
  }catch(err){toast(err.message,true);}finally{if(button&&button.isConnected){button.disabled=false;button.textContent=button.dataset.original||'Continuar';}}
}
function onChange(e){
  const target=e.target,prefix=target.dataset.locationRegion||target.dataset.locationState;
  if(target.dataset.locationRegion){
    const uf=document.getElementById(`${prefix}State`),city=document.getElementById(`${prefix}City`);
    if(uf)uf.innerHTML='<option value="">Selecione o estado</option>'+(REGIONS[target.value]||[]).map(s=>`<option>${s}</option>`).join('');
    if(city)city.value='';
    const list=document.getElementById(`${prefix}Cities`);if(list)list.innerHTML='';
  }
  if(target.dataset.locationState){const city=document.getElementById(`${prefix}City`);if(city)city.value='';fetchCities(target.value,`${prefix}Cities`);}
  if(target.matches('[data-admin-user]')){
    const id=target.dataset.adminUser,key=target.dataset.key;
    const raw=target.value;
    const value=key==='can_post'?raw==='true':raw;
    const note=key==='account_status'&&raw!=='active'?' A conta será desconectada e seus anúncios públicos serão ocultados.':'';
    if(!confirm(`Confirmar alteração de ${key}?${note}`)){adminPanel();return;}
    api('PATCH',`/api/admin/users/${id}`,{[key]:value}).then(()=>{toast('Usuário atualizado.');adminPanel();loadListings();}).catch(e=>{toast(e.message,true);adminPanel();});
    return;
  }
  if(target.id==='avatarFile'&&target.files?.[0]){
    const f=target.files[0];if(f.size>1_200_000)return toast('Foto maior que 1,2 MB.',true);
    const preview=$('#avatarPreview'),url=URL.createObjectURL(f);preview.innerHTML='';const img=document.createElement('img');img.src=url;img.onload=()=>URL.revokeObjectURL(url);img.alt='Prévia da imagem';preview.appendChild(img);
  }
}
document.addEventListener('click',onClick);
document.addEventListener('submit',onSubmit);
document.addEventListener('change',onChange);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!$('#modalLayer').hidden)closeModal();
  if((e.key==='Enter'||e.key===' ')&&e.target.classList.contains('listing-card')){e.preventDefault();listingDetail(e.target.dataset.id);}
});
$('#year').textContent=String(new Date().getFullYear());
initFilters();
await refreshSession();
await loadListings();
await loadPromotions();
const payment=new URLSearchParams(window.location.search).get('payment');
if(payment){
  window.history.replaceState({},'',window.location.pathname+window.location.hash);
  if(payment==='success'||payment==='pending'){
    toast('Pagamento em verificação. Acesse Meus anúncios para consultar a liberação.');
    if(state.user)setTimeout(myListings,350);
  }else if(payment==='failure')toast('Pagamento não concluído. Você pode tentar novamente em Meus anúncios.',true);
}
