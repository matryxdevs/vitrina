import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=file=>fs.readFileSync(path.join(root,file),'utf8');
const srv=source('server.js'),ui=source('public/app.js'),html=source('public/index.html');
const sql=source('db/schema.sql'),db=source('db/mysql.js');

test('Banco MySQL efetivo no projeto, sem SQLite na aplicação',()=>{
  assert.match(db,/mysql2\/promise/);
  assert.match(db,/mysql\.createPool/);
  assert.match(db,/pool\.execute\(sql,params\)/);
  assert.match(db,/beginTransaction\(\)/);
  assert.match(sql,/ENGINE=InnoDB/g);
  assert.doesNotMatch(srv,/node:sqlite|new DatabaseSync/);
  assert.match(source('package.json'),/"mysql2"/);
});
test('Categorias exigidas no navegador e validadas no servidor',()=>{
  assert.match(ui,/name="category" required/);
  assert.match(ui,/name="category" required/);
  assert.match(srv,/!CATEGORIES\.includes\(category\)/);
  assert.match(html,/id="heroSearchForm"/);
  assert.match(html,/id="categoryFilter"/);
  assert.match(srv,/l\.title LIKE \? OR l\.description LIKE \?/);
  assert.match(srv,/\['region','region'\]/);
});
test('Banners públicos, gestão de campanhas e validação do link HTTPS',()=>{
  assert.match(srv,/url\.pathname==='\/api\/promotions'/);
  assert.match(srv,/url\.pathname==='\/api\/admin\/promotions'/);
  assert.match(srv,/if\(urlTarget\.protocol!=='https:'\)/);
  assert.match(ui,/loadPromotions/);
  assert.match(html,/id="sitePromotions"/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS promotions/);
});
test('Administração, isolamento dos dados pessoais e bloqueio do anunciante',()=>{
  assert.match(srv,/function requireAdmin\(u\)/);
  assert.match(srv,/account_status!=='active'/);
  assert.match(srv,/if\(!u\.can_post\)/);
  assert.match(srv,/DELETE FROM sessions WHERE user_id=\?/);
  assert.match(srv,/l\.status='draft' AND u\.account_status='active'/);
  assert.match(srv,/function protectPhone/);
  assert.match(srv,/const publicUser = \(u\) => u && \(\{id:u\.id,name:u\.name,age/);
  assert.match(sql,/CREATE TABLE IF NOT EXISTS audit_logs/);
  assert.match(sql,/role ENUM\('user','seller','admin'\)/);
});
test('Apenas pagamento confirmado ativa anúncio pago',()=>{
  assert.match(srv,/total_amount:'5\.00'/);
  assert.match(srv,/Number\(o\.total_paid_amount\)===5/);
  assert.match(srv,/verifyWebhook\(req,url,payload\)/);
  assert.match(srv,/X-Idempotency-Key/);
});

test('Hostinger: inicializador sem top-level await incompatível com require(ESM)',()=>{
  assert.doesNotMatch(srv,/^if\(process\.env\.DB_AUTO_SCHEMA!=='false'\)await createSchema\(\);/m);
  assert.doesNotMatch(srv,/^await bootstrapAdmin\(\);/m);
  assert.match(srv,/async function startServer\(\)/);
  assert.match(srv,/startServer\(\)\.catch/);
  assert.match(srv,/server\.listen\(PORT, '0\.0\.0\.0'/);
});
