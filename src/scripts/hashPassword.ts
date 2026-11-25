import bcrypt from 'bcryptjs';

const password = process.argv[2];
if (!password) {
  console.log('Cara pakai: npm run hash -- <password_anda>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log('\nHash bcrypt untuk ditaruh di .env (ADMIN_ACCOUNTS):');
console.log(hash);
console.log('');
