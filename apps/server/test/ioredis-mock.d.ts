/** ioredis-mock o'z tiplarini bermaydi: testlarda faqat konstruktor va `flushall` kerak. */
declare module "ioredis-mock" {
  export default class RedisMock {
    flushall(): Promise<unknown>;
  }
}
