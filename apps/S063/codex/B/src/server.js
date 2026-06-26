const app = require("./app");

const port = Number(process.env.PORT || 5063);

app.listen(port, () => {
  console.log(`Social app listening on port ${port}`);
});
