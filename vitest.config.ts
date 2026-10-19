import {defineConfig} from 'vitest/config';
// Database replay tests intentionally walk all test devices; serialize files so
// another suite cannot delete a fixture during a replay. Concurrency is tested
// explicitly within individual ingestion tests.
export default defineConfig({test:{fileParallelism:false,testTimeout:15000,hookTimeout:30000}});
