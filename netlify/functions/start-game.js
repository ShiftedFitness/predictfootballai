exports.handler = async () => {
  const first = Math.random() < 0.5 ? 0 : 1;
  return { statusCode: 200, body: JSON.stringify({ first }) };
};
