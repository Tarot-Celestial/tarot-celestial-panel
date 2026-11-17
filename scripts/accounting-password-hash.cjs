#!/usr/bin/env node
'use strict';

// Read a secret from stdin only. Never place passwords in command arguments,
// generated source, logs or environment variable names with NEXT_PUBLIC_.
const { randomBytes, scrypt } = require('node:crypto');
const { TextDecoder } = require('node:util');

async function main() {
  if (process.argv.length !== 2) throw new Error('No se admiten argumentos. Entrega la contraseña únicamente por stdin desde un archivo privado o un gestor de secretos.');
  if (process.stdin.isTTY) throw new Error('No se admite entrada interactiva con eco. Usa stdin desde un archivo privado o un gestor de secretos.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 1026) throw new Error('La contraseña supera el límite permitido de 256 caracteres.');
    chunks.push(chunk);
  }
  let password;
  try { password = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)).replace(/\r?\n$/, ''); }
  catch { throw new Error('La entrada debe ser texto UTF-8 válido.'); }
  if (password.length < 1 || password.length > 256) throw new Error('La contraseña debe contener entre 1 y 256 caracteres.');
  const salt = randomBytes(16);
  const key = await new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(error); else resolve(derived);
    });
  });
  process.stdout.write(`scrypt$${salt.toString('hex')}$${key.toString('hex')}\n`);
}

main().catch(error => {
  // Deliberately never print input, command arguments or a stack containing them.
  process.stderr.write(`${error instanceof Error ? error.message : 'No se pudo generar el hash.'}\n`);
  process.exitCode = 1;
});
