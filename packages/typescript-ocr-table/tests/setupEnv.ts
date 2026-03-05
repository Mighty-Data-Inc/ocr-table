// Loads environment variables from .env for Vitest tests
import dotenv from 'dotenv';

console.log(`Loading .env from CWD=${process.cwd()}`);
dotenv.config();
