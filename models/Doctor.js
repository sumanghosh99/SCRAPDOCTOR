const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// const Doctor = sequelize.define(
//   "Doctor",
//   {
//     name: {
//       type: DataTypes.STRING,
//       allowNull: false,
//     },
//     profileUrl: {
//       type: DataTypes.STRING,
//       allowNull: false,
//       unique: true,
//     },
//   },
//   {
//     timestamps: true,
//     createdAt: "created_at",
//     updatedAt: false,
//   }
// );

const Doctor = sequelize.define(
  "Doctor",
  {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    degree: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    specialty: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    subSpecialty: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    certifications: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    license: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    publications: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    totalPublication: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    medicalSchool: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sourceUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    timestamps: true,
    underscored: true,
    tableName: "doctors",
  }
);

module.exports = Doctor;
