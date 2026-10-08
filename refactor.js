const fs = require('fs');
const path = require('path');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // Add async to router.(get|post|put|delete)
  content = content.replace(/router\.(get|post|put|delete)\(['"](.*?)['"],\s*(authMiddleware,\s*)?(async\s*)?\((req, res|req, res, next|_req, res)\) => {/g, (match, method, route, middleware, isAsync, args) => {
    return `router.${method}('${route}', ${middleware || ''}async (${args}) => {`;
  });

  // Add await to the db calls
  const dbMethods = ['findUserByEmail', 'findUserById', 'createUser', 'getPerfil', 'updatePerfil', 'updateUserMemory', 'updateUserProfile'];
  dbMethods.forEach(method => {
    // Add await if not already there
    const regex = new RegExp(`(?<!await\\s+)(${method}\\()`, 'g');
    content = content.replace(regex, 'await $1');
  });

  fs.writeFileSync(filePath, content, 'utf-8');
}

processFile(path.join(__dirname, 'routes', 'auth.js'));
processFile(path.join(__dirname, 'routes', 'user.js'));
processFile(path.join(__dirname, 'routes', 'gemini.js'));

console.log('Routes refactored');

