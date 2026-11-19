import { pool } from '../db/mysql.js';
try {
  const [r]=await pool.query('SELECT VERSION() AS version, DATABASE() AS db');
  console.log(`MySQL conectado: ${r[0].version} — banco ${r[0].db}`);
} catch(e) {
  console.error('Falha de conexão MySQL:',e.code||e.message);
  process.exitCode=1;
} finally { await pool.end(); }
