import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const root=path.dirname(fileURLToPath(import.meta.url));
const envFile=path.resolve(root,'../.env');
if(fs.existsSync(envFile))process.loadEnvFile(envFile);
const config={
  host:process.env.DB_HOST || '127.0.0.1',
  port:Number(process.env.DB_PORT || 3306),
  user:process.env.DB_USER || '',
  password:process.env.DB_PASSWORD || '',
  database:process.env.DB_NAME || '',
  waitForConnections:true,connectionLimit:Math.min(20,Math.max(2,Number(process.env.DB_POOL_SIZE)||6)),
  queueLimit:60,enableKeepAlive:true,dateStrings:true,
  decimalNumbers:false,
  charset:'utf8mb4',
};
if(!config.user||!config.database||!config.password)throw new Error('Defina DB_HOST, DB_USER, DB_PASSWORD e DB_NAME no ambiente Hostinger.');
if(process.env.DB_SSL==='true')config.ssl={minVersion:'TLSv1.2',rejectUnauthorized:true};
export const pool=mysql.createPool(config);

// Interface assíncrona com SQL sempre parametrizado; não interpolar entradas em consultas.
export const db={
  prepare(sql){return {
    async get(...params){const [rows]=await pool.execute(sql,params);return rows[0];},
    async all(...params){const [rows]=await pool.execute(sql,params);return rows;},
    async run(...params){const [result]=await pool.execute(sql,params);return result;}
  };}
};
export async function createSchema(){
  // Criação idempotente; se a hospedagem não conceder CREATE, importe db/schema.sql no phpMyAdmin.
  const source=await readFile(path.join(root,'schema.sql'),'utf8');
  const statements=source.replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean);
  for(const sql of statements) await pool.query(sql);
}
export async function transaction(fn){
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const ret=await fn(conn);await conn.commit();return ret;}
  catch(e){await conn.rollback();throw e;}
  finally{conn.release();}
}
