import http from 'node:http';
import { db, pool, createSchema, transaction } from './db/mysql.js';
import { randomBytes, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.indexOf('=');
    if (p > 0 && !process.env[line.slice(0, p).trim()]) process.env[line.slice(0, p).trim()] = line.slice(p + 1).trim();
  }
}
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ORIGIN = (process.env.APP_ORIGIN || `http://localhost:${PORT}`).replace(/\/$/, '');
const PROD = process.env.NODE_ENV === 'production';
const MP_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || '';
const MP_BASE = process.env.NODE_ENV === 'test' && process.env.MP_API_BASE_URL ? process.env.MP_API_BASE_URL : 'https://api.mercadopago.com';
const DATA = path.resolve(ROOT, process.env.DATA_DIR || './data');
const UPLOADS = path.resolve(ROOT, process.env.UPLOAD_DIR || './uploads');
const PUBLIC = path.join(ROOT, 'public');
const scrypt = promisify(scryptCb);
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
if (PROD && !ORIGIN.startsWith('https://')) throw new Error('Em produção APP_ORIGIN deve usar HTTPS.');
let piiKey;
if (process.env.PII_ENCRYPTION_KEY) {
  if (!/^[a-f0-9]{64}$/i.test(process.env.PII_ENCRYPTION_KEY)) throw new Error('PII_ENCRYPTION_KEY deve conter exatamente 64 caracteres hexadecimais.');
  piiKey=Buffer.from(process.env.PII_ENCRYPTION_KEY,'hex');
} else if (PROD) {
  throw new Error('Em produção configure PII_ENCRYPTION_KEY para criptografar o WhatsApp dos usuários.');
} else {
  const keyFile=path.join(DATA,'.pii-key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});
  piiKey=Buffer.from(fs.readFileSync(keyFile,'utf8').trim(),'hex');
}
function protectPhone(phone) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',piiKey,iv);
  const data=Buffer.concat([cipher.update(phone,'utf8'),cipher.final()]);
  return `enc:v1:${iv.toString('hex')}:${data.toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
}
function revealPhone(stored) {
  if (!stored?.startsWith('enc:v1:')) return stored || '';
  const [,version,iv,ciphertext,tag]=stored.split(':');
  if(version!=='v1') throw Error('Versão de criptografia inválida.');
  const decipher=createDecipheriv('aes-256-gcm',piiKey,Buffer.from(iv,'hex'));
  decipher.setAuthTag(Buffer.from(tag,'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext,'hex')),decipher.final()]).toString('utf8');
}
// A preparação do MySQL ocorre em iniciarAplicacao(), sem top-level await.
const REGIONS = {
  Norte: ['AC','AP','AM','PA','RO','RR','TO'],
  Nordeste: ['AL','BA','CE','MA','PB','PE','PI','RN','SE'],
  'Centro-Oeste': ['DF','GO','MT','MS'],
  Sudeste: ['ES','MG','RJ','SP'],
  Sul: ['PR','RS','SC']
};
const STATES = Object.fromEntries(Object.entries(REGIONS).flatMap(([r, states]) => states.map(s => [s,r])));
const CATEGORIES = ['Eletrônicos','Veículos','Imóveis','Casa e móveis','Eletrodomésticos','Ferramentas','Moda','Esporte e lazer','Serviços','Empregos','Outros'];
const rate = new Map();
const MAX_BYTES = 5 * 1024 * 1024;
const now = () => Date.now();
const hash = (s) => createHash('sha256').update(s).digest('hex');
const trim = (s, max=200) => typeof s === 'string' ? s.trim().slice(0,max) : '';
const emailNormalize = (s) => trim(s, 254).toLowerCase();
const publicUser = (u) => u && ({id:u.id,name:u.name,age:u.age,region:u.region,state:u.state,city:u.city,avatar:u.avatar,created_at:u.created_at});
const selfUser = (u) => u && ({...publicUser(u),email:u.email,whatsapp:revealPhone(u.whatsapp),role:u.role,account_status:u.account_status,can_post:!!u.can_post});
const userById = async (id) => await db.prepare('SELECT * FROM users WHERE id=?').get(id);
const query = async (sql, ...args) => await db.prepare(sql).all(...args);
function limit(key, max, durationMs) {
  const t=now(), x=rate.get(key);
  if (!x || x.until<=t) {rate.set(key,{n:1,until:t+durationMs}); return true;}
  if(x.n>=max) return false;
  x.n++;return true;
}
setInterval(async () => {for(const [k,v] of rate) if(v.until<=now()) rate.delete(k); try{await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());}catch(e){console.error('[limpeza sessões]',e.code||e.message);}},60*60*1000).unref();
const json = (res, code, data) => {
  const dataStr=JSON.stringify(data);
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(dataStr);
};
const fail = (status, message) => Object.assign(new Error(message), { status });
function body(req) {return new Promise((resolve,reject)=>{
  let total=0, chunks=[];
  req.on('data',(b)=>{total+=b.length; if(total>MAX_BYTES){reject(fail(413,'Arquivo ou requisição grande demais.'));req.destroy();return;}chunks.push(b);});
  req.on('end',()=>{try{const o=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'); if(!o || typeof o!=='object'||Array.isArray(o)) throw new Error();resolve(o);}catch{reject(fail(400,'JSON inválido.'));}});
  req.on('error',reject);
});}
function checkOrigin(req) {
  const o=req.headers.origin;
  if (!o || o !== ORIGIN) throw fail(403,'Origem não autorizada.');
}
function cookies(req) {
  const c={};
  for (const p of (req.headers.cookie||'').split(';')) {const i=p.indexOf('='); if(i>0)c[p.slice(0,i).trim()]=p.slice(i+1).trim();}
  return c;
}
const cookieName = PROD?'__Host-vitrina_sid':'vitrina_sid';
async function auth(req) {
  const token=cookies(req)[cookieName];
  if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session=await db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), now());
  return session ? await userById(session.user_id) : null;
}
function requireUser(u){if(!u)throw fail(401,'Entre na sua conta para continuar.');if(u.account_status!=='active')throw fail(403,'Conta suspensa ou bloqueada. Contate a administração.');return u;}
function requireAdmin(u){requireUser(u);if(u.role!=='admin')throw fail(403,'Acesso exclusivo da administração.');return u;}
async function setSession(res, userId) {
  const token=randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hash(token),userId,now()+7*24*3600*1000);
  res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax${PROD?'; Secure':''}`);
}
async function clearSession(req,res){const t=cookies(req)[cookieName];if(t)await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(t));res.setHeader('Set-Cookie',`${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${PROD?'; Secure':''}`);}
async function passwordHash(password) {const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return `scrypt$${salt}$${key.toString('hex')}`;}
async function checkPassword(password, stored) {
  const [alg,salt,hex]=(stored||'').split('$');if(alg!=='scrypt'||!salt||!hex)return false;
  const actual=await scrypt(password,salt,64);const expected=Buffer.from(hex,'hex');return expected.length===actual.length&&timingSafeEqual(actual,expected);
}
function placeValues(data) {
  const state=trim(data.state,2).toUpperCase(), city=trim(data.city,90);
  const region=STATES[state];
  if(!region||!city||city.length<2||data.region!==region) throw fail(400,'Informe região, estado (UF) e cidade válidos.');
  return {region,state,city};
}
function validProfile(x){
  const name=trim(x.name,80), age=Number(x.age), phone=trim(x.whatsapp,22).replace(/\D/g,'');
  const location=placeValues(x);
  if(name.length<2||!Number.isInteger(age)||age<18||age>110||phone.length<10||phone.length>13) throw fail(400,'Informe nome, idade (18+), cidade e WhatsApp válido.');
  return {name,age,whatsapp:phone,...location};
}
function saveImage(data, type) {
  if(!data) return null;
  if(typeof data!=='string'||data.length>4_300_000)throw fail(400,'Imagem acima do limite permitido.');
  const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if(!m)throw fail(400,'Envie uma imagem JPG, PNG ou WebP.');
  const file=Buffer.from(m[2],'base64');
  const limitBytes=type==='avatar'?1_200_000:3_000_000;
  if(file.length<30||file.length>limitBytes)throw fail(400,`Imagem deve ter até ${type==='avatar'?'1,2':'3'} MB.`);
  const [sub,extension]=[m[1],m[1]==='jpeg'?'jpg':m[1]];
  const valid=sub==='jpeg'?file.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])):
    sub==='png'?file.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    file.subarray(0,4).toString()==='RIFF'&&file.subarray(8,12).toString()==='WEBP';
  if(!valid)throw fail(400,'Conteúdo da imagem inválido.');
  const filename=`${randomUUID()}.${extension}`;
  fs.writeFileSync(path.join(UPLOADS,filename),file,{flag:'wx',mode:0o644});
  return `/uploads/${filename}`;
}
function validateListing(data) {
  const title=trim(data.title,110), description=trim(data.description,2500), category=trim(data.category,50), price=Number(data.price);
  if(title.length<5 || description.length<15 || !CATEGORIES.includes(category) || !Number.isFinite(price) || price<0||price>100_000_000 || !/^\d+(\.\d{1,2})?$/.test(String(data.price)))
    throw fail(400,'Preencha título (5+), descrição (15+), categoria e preço válido.');
  return {title,description,category,price_cents:Math.round(price*100)};
}
const listingSelect = `SELECT l.id,l.user_id,l.title,l.description,l.category,l.price_cents,l.image,l.region,l.state,l.city,l.status,l.created_at,
  u.name AS seller_name,u.avatar AS seller_avatar,u.age AS seller_age FROM listings l JOIN users u ON u.id=l.user_id`;
function safeListing(row,owner=false){if(!row)return null;return {...row,...(!owner?{status:undefined}:{}),price:row.price_cents/100};}
async function mpFetch(endpoint, method='GET', payload, idempotency) {
  if(!MP_TOKEN) throw fail(503,'Pagamento ainda não configurado pelo administrador.');
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const headers={'Authorization':`Bearer ${MP_TOKEN}`,'Content-Type':'application/json'};
    if(idempotency)headers['X-Idempotency-Key']=idempotency;
    const response=await fetch(MP_BASE+endpoint,{method,headers,body:payload?JSON.stringify(payload):undefined,signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) {console.error('[Mercado Pago]',response.status,JSON.stringify(data).slice(0,500));throw fail(502,'Mercado Pago indisponível ou credenciais inválidas.');}
    return data;
  } catch(e){if(e.status)throw e;throw fail(502,'Não foi possível conectar ao Mercado Pago.');}
  finally {clearTimeout(timer);}
}
function verifyWebhook(req,url,data) {
  if(!WEBHOOK_SECRET) return false;
  const dataId=url.searchParams.get('data.id');
  const requestId=req.headers['x-request-id'];
  const xSignature=req.headers['x-signature'];
  if(!dataId||!requestId||!xSignature||data?.data?.id && data.data.id.toString()!==dataId)return false;
  const chunks=Object.fromEntries(xSignature.split(',').map(x=>x.trim().split('=')));
  if(!/^\d{10,16}$/.test(chunks.ts||'')||!/^[a-f0-9]{64}$/.test(chunks.v1||''))return false;
  const template=`id:${dataId.toLowerCase()};request-id:${requestId};ts:${chunks.ts};`;
  const digest=createHmac('sha256',WEBHOOK_SECRET).update(template).digest('hex');
  return timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(chunks.v1,'hex'));
}
async function syncMpOrder(mpId){
  const p=await db.prepare('SELECT * FROM payment_orders WHERE mp_order_id=?').get(mpId);
  if(!p) return {found:false};
  const o=await mpFetch(`/v1/orders/${encodeURIComponent(mpId)}`);
  if(String(o.id)!==mpId||o.external_reference!==`ad_${p.listing_id}`||o.currency!=='BRL'||Number(o.total_amount)!==5) return {found:true,approved:false};
  const approved=o.status==='processed' && o.status_detail==='accredited' && Number(o.total_paid_amount)===5;
  const reversed=['refunded','charged_back','cancelled'].includes(o.status)||['refunded','charged_back'].includes(o.status_detail);
  await transaction(async conn=>{
    await conn.execute('UPDATE payment_orders SET status=? WHERE id=?',[trim(o.status,40),p.id]);
    if(approved)await conn.execute(`UPDATE listings l JOIN users u ON u.id=l.user_id
      SET l.status='active',l.paid_order_id=? WHERE l.id=? AND l.status='draft' AND u.account_status='active'`,[mpId,p.listing_id]);
    if(reversed)await conn.execute("UPDATE listings SET status='hidden' WHERE id=? AND paid_order_id=? AND status='active'",[p.listing_id,mpId]);
  });
  return {found:true,approved,reversed};
}
function serve(res, filepath, contentType, isImage=false){
  try {const stat=fs.statSync(filepath);if(!stat.isFile())throw Error();
    res.writeHead(200, {'Content-Type':contentType,'Content-Length':stat.size,'Cache-Control':isImage?'public, max-age=604800':'no-cache','X-Content-Type-Options':'nosniff'});
    fs.createReadStream(filepath).pipe(res);
  } catch{json(res,404,{error:'Arquivo não encontrado.'});}
}
async function audit(adminId,action,type,target){
  await db.prepare('INSERT INTO audit_logs (id,admin_id,action,target_type,target_id) VALUES (?,?,?,?,?)').run(randomUUID(),adminId,action,type,String(target));
}
async function bootstrapAdmin(){
  const email=emailNormalize(process.env.ADMIN_EMAIL), password=process.env.ADMIN_PASSWORD||'';
  if(!email||!password || password.startsWith('SUBSTITUA_'))return;
  if(password.length<16) {console.warn('ADMIN_PASSWORD deve ter no mínimo 16 caracteres.');return;}
  if(await db.prepare('SELECT id FROM users WHERE email=?').get(email))return;
  const id=randomUUID(),pass=await passwordHash(password);
  await db.prepare('INSERT INTO users (id,name,email,password_hash,role,age,region,state,city,whatsapp) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id,'Administração',email,pass,'admin',18,'Norte','PA','Não informado',protectPhone('0000000000'));
  console.log('Conta administrativa inicial criada:',email);
}
// A criação da conta administrativa ocorre em iniciarAplicacao().
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,ORIGIN), method=req.method;
  const ip=req.socket.remoteAddress||'unknown';
    res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; base-uri 'none'; form-action 'self' https://www.mercadopago.com.br; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; connect-src 'self' https://servicodados.ibge.gov.br; script-src 'self'; style-src 'self'");
  if(PROD)res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  try {
    if(req.url.length>2500)throw fail(414,'URL longa demais.');
    if(!limit(`global:${ip}`,360,60_000))throw fail(429,'Muitas requisições. Tente novamente.');
    if(url.pathname.startsWith('/api/')) {
      if(method!=='GET'&&method!=='HEAD'&&url.pathname!=='/api/webhooks/mercadopago')checkOrigin(req);
      const u=await auth(req);
      if(method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true});
      if(method==='GET'&&url.pathname==='/api/me')return json(res,200,{user:selfUser(u),pricePerListing:5,configured:!!(MP_TOKEN&&WEBHOOK_SECRET)});
      if(method==='GET'&&url.pathname==='/api/categories')return json(res,200,{categories:CATEGORIES});
      if(method==='GET'&&url.pathname==='/api/promotions'){
        const ads=await query("SELECT id,title,body,image,button_label,target_url FROM promotions WHERE status='active' ORDER BY priority DESC,created_at DESC LIMIT 3");
        return json(res,200,{promotions:ads});
      }
      if(method==='POST'&&url.pathname==='/api/register'){
        if(!limit(`register:${ip}`,6,60*60*1000))throw fail(429,'Limite de cadastros excedido.');
        const data=await body(req), profile=validProfile(data), email=emailNormalize(data.email),password=data.password;
        if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254 ||typeof password!=='string'||password.length<12||password.length>128)throw fail(400,'Informe e-mail válido e senha com 12 a 128 caracteres.');
        if(await db.prepare('SELECT 1 FROM users WHERE email=?').get(email))throw fail(409,'E-mail já cadastrado.');
        const pass=await passwordHash(password),id=randomUUID();
        try{await db.prepare('INSERT INTO users (id,name,email,password_hash,age,region,state,city,whatsapp) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id,profile.name,email,pass,profile.age,profile.region,profile.state,profile.city,protectPhone(profile.whatsapp));}catch{throw fail(409,'E-mail já cadastrado.');}
        await setSession(res,id);return json(res,201,{user:selfUser(await userById(id))});
      }
      if(method==='POST'&&url.pathname==='/api/login'){
        if(!limit(`login:${ip}`,12,15*60*1000))throw fail(429,'Muitas tentativas. Aguarde 15 minutos.');
        const data=await body(req), e=emailNormalize(data.email);
        if(!limit(`login-account:${hash(e)}`,7,15*60*1000))throw fail(429,'Muitas tentativas de acesso para esta conta.');
        const user=await db.prepare('SELECT * FROM users WHERE email=?').get(e);
        if(user && user.account_status!=='active')throw fail(403,'Conta suspensa ou bloqueada.');
        if(!user||typeof data.password!=='string'||!await checkPassword(data.password,user.password_hash))throw fail(401,'E-mail ou senha incorretos.');
        await setSession(res,user.id);return json(res,200,{user:selfUser(user)});
      }
      if(method==='POST'&&url.pathname==='/api/logout'){await clearSession(req,res);return json(res,200,{ok:true});}
      if(method==='PATCH'&&url.pathname==='/api/me'){
        requireUser(u);const data=await body(req),p=validProfile(data),avatar=data.avatarData?saveImage(data.avatarData,'avatar'):u.avatar;
        await db.prepare('UPDATE users SET name=?,age=?,region=?,state=?,city=?,whatsapp=?,avatar=? WHERE id=?')
          .run(p.name,p.age,p.region,p.state,p.city,protectPhone(p.whatsapp),avatar,u.id);
        return json(res,200,{user:selfUser(await userById(u.id))});
      }
      const userPage=url.pathname.match(/^\/api\/users\/([a-f0-9-]{36})$/);
      if(method==='GET'&&userPage){const x=await userById(userPage[1]);if(!x || x.account_status!=='active')throw fail(404,'Usuário não encontrado.');return json(res,200,{user:publicUser(x)});}
      if(method==='GET'&&url.pathname==='/api/listings'){
        const filters=["l.status='active'","u.account_status='active'"], args=[];
        for(const [name,column] of [['region','region'],['state','state'],['city','city'],['category','category']]){
          const v=trim(url.searchParams.get(name),90);if(v){filters.push(`l.${column} ${name==='city'?'LIKE':'='} ?`);args.push(name==='city'?`%${v}%`:v);}
        }
        const s=trim(url.searchParams.get('search'),80);if(s){filters.push('(l.title LIKE ? OR l.description LIKE ?)');args.push(`%${s}%`,`%${s}%`);}
        const page=Math.min(100,Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1)));
        const total=(await db.prepare(`SELECT COUNT(*) AS n FROM listings l JOIN users u ON u.id=l.user_id WHERE ${filters.join(' AND ')}`).get(...args)).n;
        const rows=await query(`${listingSelect} WHERE ${filters.join(' AND ')} ORDER BY l.created_at DESC LIMIT 18 OFFSET ?`,...args,(page-1)*18);
        return json(res,200,{listings:rows.map(r=>safeListing(r)),pagination:{page,total,hasMore:page*18<total}});
      }
      if(method==='GET'&&url.pathname==='/api/listings/mine'){
        requireUser(u);
        return json(res,200,{listings:(await query(`${listingSelect} WHERE l.user_id=? ORDER BY l.created_at DESC LIMIT 100`,u.id)).map(r=>safeListing(r,true))});
      }
      if(method==='POST'&&url.pathname==='/api/listings'){
        requireUser(u);
        if(!u.can_post)throw fail(403,'Sua permissão para anunciar foi desativada pela administração.');
        if(!limit(`post:${u.id}`,12,60*60*1000))throw fail(429,'Limite de anúncios por hora excedido.');
        const data=await body(req),x=validateListing(data),id=randomUUID(),photo=saveImage(data.imageData,'listing');
        await db.prepare('INSERT INTO listings (id,user_id,title,description,category,price_cents,image,region,state,city) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id,u.id,x.title,x.description,x.category,x.price_cents,photo,u.region,u.state,u.city);
        if(u.role==='user')await db.prepare("UPDATE users SET role='seller' WHERE id=? AND role='user'").run(u.id);
        return json(res,201,{id,status:'draft',publicationFee:5});
      }
      const listingMatch=url.pathname.match(/^\/api\/listings\/([a-f0-9-]{36})$/);
      if(method==='GET'&&listingMatch){
        const l=await db.prepare(`${listingSelect} WHERE l.id=?`).get(listingMatch[1]);
        if(!l||l.status!=='active'&&l.user_id!==u?.id&&u?.role!=='admin')throw fail(404,'Anúncio não disponível.');
        return json(res,200,{listing:safeListing(l,l.user_id===u?.id||u?.role==='admin')});
      }
      if(method==='DELETE'&&listingMatch){
        requireUser(u);const l=await db.prepare('SELECT * FROM listings WHERE id=?').get(listingMatch[1]);
        if(!l||l.user_id!==u.id&&u.role!=='admin')throw fail(404,'Anúncio não encontrado.');
        await db.prepare("UPDATE listings SET status='removed' WHERE id=?").run(l.id);return json(res,200,{ok:true});
      }
      const reportMatch=url.pathname.match(/^\/api\/listings\/([a-f0-9-]{36})\/report$/);
      if(method==='POST'&&reportMatch){
        requireUser(u);
        if(!limit(`reports:${u.id}`,5,60*60*1000))throw fail(429,'Limite de denúncias por hora excedido.');
        const l=await db.prepare("SELECT l.* FROM listings l JOIN users s ON s.id=l.user_id WHERE l.id=? AND l.status='active' AND s.account_status='active'").get(reportMatch[1]);
        if(!l)throw fail(404,'Anúncio não encontrado.');
        if(l.user_id===u.id)throw fail(400,'Você não pode denunciar seu próprio anúncio.');
        const r=await body(req),reason=trim(r.reason,600);
        if(reason.length<10)throw fail(400,'Descreva o motivo da denúncia em pelo menos 10 caracteres.');
        await db.prepare('INSERT IGNORE INTO reports (id,listing_id,reporter_id,reason) VALUES (?,?,?,?)').run(randomUUID(),l.id,u.id,reason);
        return json(res,201,{ok:true});
      }
      const checkoutMatch=url.pathname.match(/^\/api\/listings\/([a-f0-9-]{36})\/checkout$/);
      if(method==='POST'&&checkoutMatch){
        requireUser(u);
        if(!limit(`pay:${u.id}`,20,60*60*1000))throw fail(429,'Muitas tentativas de pagamento.');
        const l=await db.prepare('SELECT * FROM listings WHERE id=?').get(checkoutMatch[1]);
        if(!l||l.user_id!==u.id)throw fail(404,'Anúncio não encontrado.');
        if(l.status!=='draft')throw fail(409,'Este anúncio já foi publicado ou não está disponível.');
        if(!MP_TOKEN||!WEBHOOK_SECRET)throw fail(503,'Pagamento ainda não configurado pelo administrador.');
        const prev=await db.prepare("SELECT * FROM payment_orders WHERE listing_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(l.id);
        if(prev && Date.now()-Date.parse(String(prev.created_at).replace(' ','T')+'Z')<22*60*60*1000) return json(res,200,{checkoutUrl:prev.checkout_url});
        const p=await mpFetch('/v1/orders','POST',{
          type:'online',processing_mode:'manual',capture_mode:'automatic_async',
          total_amount:'5.00',external_reference:`ad_${l.id}`,
          description:'Taxa de publicação - Vitrina Marketplace',
          payer:{email:u.email},items:[{title:'Publicação de 1 anúncio',quantity:1,unit_price:'5.00'}],
          config:{online:{success_url:`${ORIGIN}/?payment=success`,failure_url:`${ORIGIN}/?payment=failure`,pending_url:`${ORIGIN}/?payment=pending`,auto_return:'approved'}}
        }, randomUUID());
        if(!p.id||!p.checkout_url || !/^https:\/\//.test(p.checkout_url))throw fail(502,'Resposta incompleta do Mercado Pago.');
        await db.prepare('INSERT INTO payment_orders (id,listing_id,mp_order_id,checkout_url) VALUES (?,?,?,?)').run(randomUUID(),l.id,String(p.id),p.checkout_url);
        return json(res,200,{checkoutUrl:p.checkout_url});
      }
      const syncMatch=url.pathname.match(/^\/api\/listings\/([a-f0-9-]{36})\/check-payment$/);
      if(method==='POST'&&syncMatch){
        requireUser(u);const l=await db.prepare('SELECT * FROM listings WHERE id=?').get(syncMatch[1]);
        if(!l||l.user_id!==u.id)throw fail(404,'Anúncio não encontrado.');
        if(!limit(`sync:${u.id}`,8,60_000))throw fail(429,'Aguarde antes de consultar novamente.');
        const payments=await query('SELECT mp_order_id FROM payment_orders WHERE listing_id=? ORDER BY created_at DESC LIMIT 5',l.id);
        for(const o of payments){const status=await syncMpOrder(o.mp_order_id);if(status.approved)break;}
        return json(res,200,{status:(await db.prepare('SELECT status FROM listings WHERE id=?').get(l.id)).status});
      }
      if(method==='POST'&&url.pathname==='/api/webhooks/mercadopago'){
        const payload=await body(req);
        if(!verifyWebhook(req,url,payload))throw fail(401,'Assinatura da notificação inválida.');
        const id=url.searchParams.get('data.id'), type=url.searchParams.get('type')||payload.type;
        if(type!=='order'||!/^[A-Za-z0-9-]{8,90}$/.test(id||''))return json(res,200,{ok:true,ignored:true});
        const result=await syncMpOrder(id);
        return json(res,200,{ok:true,...result});
      }
      if(method==='POST'&&url.pathname==='/api/chat/start'){
        requireUser(u);
        if(!limit(`chat:${u.id}`,30,60_000))throw fail(429,'Limite de mensagens excedido.');
        const data=await body(req), id=trim(data.listingId,40),txt=trim(data.text,1000);
        if(txt.length<1||txt.length>1000)throw fail(400,'Digite uma mensagem.');
        const l=await db.prepare("SELECT l.* FROM listings l JOIN users s ON s.id=l.user_id WHERE l.id=? AND l.status='active' AND s.account_status='active'").get(id);
        if(!l)throw fail(404,'Anúncio não disponível.');
        if(l.user_id===u.id)throw fail(400,'Você não pode conversar consigo mesmo.');
        await db.prepare('INSERT IGNORE INTO conversations (id,listing_id,buyer_id,seller_id) VALUES (?,?,?,?)').run(randomUUID(),l.id,u.id,l.user_id);
        const c=await db.prepare('SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?').get(l.id,u.id);
        await db.prepare('INSERT INTO messages (id,conversation_id,sender_id,text) VALUES (?,?,?,?)').run(randomUUID(),c.id,u.id,txt);
        return json(res,201,{conversationId:c.id});
      }
      if(method==='GET'&&url.pathname==='/api/chat/conversations'){
        requireUser(u);
        const data=await query(`SELECT c.id,c.listing_id,l.title AS listing_title,l.image AS listing_image,
          CASE WHEN c.buyer_id=? THEN s.name ELSE b.name END AS partner_name,
          CASE WHEN c.buyer_id=? THEN s.avatar ELSE b.avatar END AS partner_avatar,
          (SELECT text FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_message,
          (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS last_at
          FROM conversations c JOIN listings l ON l.id=c.listing_id JOIN users b ON b.id=c.buyer_id JOIN users s ON s.id=c.seller_id
          WHERE c.buyer_id=? OR c.seller_id=? ORDER BY last_at DESC LIMIT 100`,u.id,u.id,u.id,u.id);
        return json(res,200,{conversations:data});
      }
      const chatMatch=url.pathname.match(/^\/api\/chat\/([a-f0-9-]{36})\/messages$/);
      if(chatMatch){
        requireUser(u);
        const c=await db.prepare('SELECT * FROM conversations WHERE id=? AND (buyer_id=? OR seller_id=?)').get(chatMatch[1],u.id,u.id);
        if(!c)throw fail(404,'Conversa não encontrada.');
        if(method==='GET')return json(res,200,{messages:await query(`SELECT m.id,m.sender_id,m.text,m.created_at, u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at ASC,m.id ASC LIMIT 200`,c.id)});
        if(method==='POST'){
          if(!limit(`chat:${u.id}`,30,60_000))throw fail(429,'Limite de mensagens excedido.');
          const data=await body(req),t=trim(data.text,1000);
          if(!t)throw fail(400,'Digite uma mensagem.');
          await db.prepare('INSERT INTO messages (id,conversation_id,sender_id,text) VALUES (?,?,?,?)').run(randomUUID(),c.id,u.id,t);
          return json(res,201,{ok:true});
        }
      }
      if(method==='GET'&&url.pathname==='/api/admin/dashboard'){
        requireAdmin(u);
        const [stats]=await pool.query(`SELECT
          (SELECT COUNT(*) FROM users WHERE role<>'admin') AS users_total,
          (SELECT COUNT(*) FROM users WHERE role='seller') AS sellers_total,
          (SELECT COUNT(*) FROM users WHERE account_status<>'active') AS blocked_total,
          (SELECT COUNT(*) FROM listings WHERE status='active') AS active_listings,
          (SELECT COUNT(*) FROM listings WHERE status='draft') AS pending_listings,
          (SELECT COUNT(*) FROM promotions WHERE status='active') AS active_promotions`);
        return json(res,200,{stats:stats[0]});
      }
      if(method==='GET'&&url.pathname==='/api/admin/users'){
        requireAdmin(u);
        const users=await query(`SELECT x.id,x.name,x.email,x.role,x.account_status,x.can_post,x.age,x.region,x.state,x.city,x.whatsapp,x.avatar,x.created_at,
          (SELECT COUNT(*) FROM listings l WHERE l.user_id=x.id) AS total_listings
          FROM users x ORDER BY x.created_at DESC LIMIT 500`);
        await audit(u.id,'view_private_contacts','users','listing');
        return json(res,200,{users:users.map(x=>({...x,whatsapp:revealPhone(x.whatsapp),can_post:!!x.can_post}))});
      }
      const manageUser=url.pathname.match(/^\/api\/admin\/users\/([a-f0-9-]{36})$/);
      if(method==='PATCH'&&manageUser){
        requireAdmin(u);
        const target=await userById(manageUser[1]);
        if(!target)throw fail(404,'Usuário não encontrado.');
        if(target.id===u.id || target.role==='admin')throw fail(403,'Não é permitido alterar contas administrativas por este painel.');
        const data=await body(req);
        const values={};
        if(Object.hasOwn(data,'account_status')){
          if(!['active','suspended','banned'].includes(data.account_status))throw fail(400,'Situação de conta inválida.');
          values.account_status=data.account_status;
        }
        if(Object.hasOwn(data,'can_post')){
          if(typeof data.can_post!=='boolean')throw fail(400,'Permissão para anunciar inválida.');
          values.can_post=data.can_post?1:0;
        }
        if(Object.hasOwn(data,'role')){
          if(!['user','seller'].includes(data.role))throw fail(400,'Tipo de conta inválido.');
          values.role=data.role;
        }
        const entries=Object.entries(values);
        if(!entries.length)throw fail(400,'Nenhuma alteração informada.');
        await transaction(async conn=>{
          await conn.execute(`UPDATE users SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...entries.map(([,v])=>v),target.id]);
          if(values.account_status && values.account_status!=='active'){
            await conn.execute('DELETE FROM sessions WHERE user_id=?',[target.id]);
            await conn.execute("UPDATE listings SET status='hidden' WHERE user_id=? AND status='active'",[target.id]);
          }
        });
        await audit(u.id,`update_user:${entries.map(([k,v])=>`${k}=${v}`).join(',')}`,'user',target.id);
        return json(res,200,{ok:true});
      }
      if(method==='GET'&&url.pathname==='/api/admin/reports'){
        requireAdmin(u);
        return json(res,200,{reports:await query('SELECT r.id,r.reason,r.created_at,l.id AS listing_id,l.title AS listing_title,u.name AS reporter_name FROM reports r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.reporter_id ORDER BY r.created_at DESC LIMIT 500')});
      }
      if(method==='GET'&&url.pathname==='/api/admin/listings'){
        requireAdmin(u);
        return json(res,200,{listings:await query(`${listingSelect} ORDER BY l.created_at DESC LIMIT 500`)});
      }
      const manageListing=url.pathname.match(/^\/api\/admin\/listings\/([a-f0-9-]{36})\/(hide|restore|remove)$/);
      if(method==='POST'&&manageListing){
        requireAdmin(u);
        const [,id,action]=manageListing;
        const l=await db.prepare('SELECT * FROM listings WHERE id=?').get(id);
        if(!l)throw fail(404,'Anúncio não encontrado.');
        if(action==='restore'){
          if(l.status!=='hidden'||!l.paid_order_id)throw fail(409,'Somente anúncios ocultos e pagos podem ser restaurados.');
          const payment=await db.prepare('SELECT status FROM payment_orders WHERE listing_id=? AND mp_order_id=?').get(id,l.paid_order_id);
          const seller=await userById(l.user_id);
          if(payment?.status!=='processed' || seller?.account_status!=='active')throw fail(409,'Pagamento não elegível ou usuário suspenso.');
          await db.prepare("UPDATE listings SET status='active' WHERE id=? AND status='hidden'").run(id);
        }else {
          await db.prepare("UPDATE listings SET status=? WHERE id=?").run(action==='remove'?'removed':'hidden',id);
        }
        await audit(u.id,`listing_${action}`,'listing',id);
        return json(res,200,{ok:true});
      }
      if(method==='GET'&&url.pathname==='/api/admin/promotions'){
        requireAdmin(u);
        return json(res,200,{promotions:await query('SELECT id,title,body,image,button_label,target_url,status,priority,created_at,updated_at FROM promotions ORDER BY created_at DESC LIMIT 150')});
      }
      if(method==='POST'&&url.pathname==='/api/admin/promotions'){
        requireAdmin(u);
        if(!limit(`promotion:${u.id}`,20,60*60*1000))throw fail(429,'Limite de campanhas excedido.');
        const data=await body(req);
        const title=trim(data.title,100),description=trim(data.body,500),button=trim(data.button_label,35),target=trim(data.target_url,700),priority=Number(data.priority||3);
        if(title.length<4||description.length<10||!Number.isInteger(priority)||priority<1||priority>5)throw fail(400,'Preencha título, mensagem (mínimo 10 caracteres) e prioridade de 1 a 5.');
        if(target){try{const urlTarget=new URL(target);if(urlTarget.protocol!=='https:')throw Error();}catch{throw fail(400,'O link da campanha precisa começar com https://.');}}
        const image=data.imageData?saveImage(data.imageData,'listing'):null,id=randomUUID();
        await db.prepare('INSERT INTO promotions (id,title,body,image,button_label,target_url,status,priority,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id,title,description,image,button||null,target||null,'active',priority,u.id);
        await audit(u.id,'promotion_create','promotion',id);
        return json(res,201,{id,ok:true});
      }
      const managePromotion=url.pathname.match(/^\/api\/admin\/promotions\/([a-f0-9-]{36})$/);
      if(managePromotion){
        requireAdmin(u);
        const existing=await db.prepare('SELECT id FROM promotions WHERE id=?').get(managePromotion[1]);
        if(!existing)throw fail(404,'Campanha não encontrada.');
        if(method==='PATCH'){
          const data=await body(req);
          if(!['active','paused'].includes(data.status))throw fail(400,'Situação inválida.');
          await db.prepare('UPDATE promotions SET status=? WHERE id=?').run(data.status,existing.id);
          await audit(u.id,`promotion_${data.status}`,'promotion',existing.id);
          return json(res,200,{ok:true});
        }
        if(method==='DELETE'){
          await db.prepare('DELETE FROM promotions WHERE id=?').run(existing.id);
          await audit(u.id,'promotion_delete','promotion',existing.id);
          return json(res,200,{ok:true});
        }
      }
      if(method==='GET'&&url.pathname==='/api/admin/payments'){
        requireAdmin(u);
        const payments=await query(`SELECT p.id,p.mp_order_id,p.status,p.created_at,l.title AS listing_title,x.name AS seller_name
          FROM payment_orders p JOIN listings l ON l.id=p.listing_id JOIN users x ON x.id=l.user_id
          ORDER BY p.created_at DESC LIMIT 250`);
        return json(res,200,{payments});
      }
      if(method==='GET'&&url.pathname==='/api/admin/audit'){
        requireAdmin(u);
        return json(res,200,{logs:await query('SELECT a.action,a.target_type,a.target_id,a.created_at,u.name AS admin_name FROM audit_logs a JOIN users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 120')});
      }
      throw fail(404,'Endpoint não encontrado.');
    }
    if(method!=='GET'&&method!=='HEAD')throw fail(405,'Método não permitido.');
    if(url.pathname.startsWith('/uploads/')) {
      const file=url.pathname.slice('/uploads/'.length);
      if(!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(file))throw fail(404,'Imagem não encontrada.');
      const ext=path.extname(file);
      return serve(res,path.join(UPLOADS,file),{'.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[ext],true);
    }
    const allowed={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
    const filepath=allowed[url.pathname];if(!filepath)throw fail(404,'Página não encontrada.');
    return serve(res,path.join(PUBLIC,filepath),{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[path.extname(filepath)]);
  }catch(err){
    if(err.status) return json(res,err.status,{error:err.message});
    console.error('[server error]',err);
    if(!res.headersSent)json(res,500,{error:'Ocorreu um erro inesperado.'});else res.end();
  }
});
// Hostinger / LiteSpeed carrega este arquivo por require().
// Evitar top-level await para compatibilidade com esse mecanismo de inicialização.
async function iniciarAplicacao() {
  if (process.env.DB_AUTO_SCHEMA !== 'false') await createSchema();
  await bootstrapAdmin();
  server.listen(PORT, HOST, () => {
    console.log(`Vitrina Marketplace iniciado em ${HOST}:${PORT} (${ORIGIN})`);
  });
}
iniciarAplicacao().catch((error) => {
  console.error('[Falha ao iniciar o VITRINA]', error);
  process.exitCode = 1;
  pool.end().catch(() => {}).finally(() => process.exit(1));
});
