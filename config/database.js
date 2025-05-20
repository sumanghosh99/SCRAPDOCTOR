import { Sequelize } from "sequelize";

const sequelize = new Sequelize("my-app", "postgres", "ghosh@123", {
  host: "localhost",
  dialect: "postgres",
  logging: false,
});

export default sequelize;
