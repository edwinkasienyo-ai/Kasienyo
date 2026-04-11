const { hashPassword } = require("../src/utils/password");

async function run() {
  const value = process.argv[2] || "1234";
  const hash = await hashPassword(value);
  // eslint-disable-next-line no-console
  console.log(hash);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
