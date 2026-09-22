const express = require("express");
const knex = require("../db/db");

const router = express.Router();

router.get("/", (req, res) => {
    const response = {
        message: "Hello from Express server",
    };
    res.status(200).json(response);
});

router.get('/get',async (req, res) => {
    const employees = await knex('employees').select('*');
    res.status(200).json(employees);
});

module.exports = router;    