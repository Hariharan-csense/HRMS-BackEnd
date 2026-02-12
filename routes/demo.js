const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
    const response = {
        message: "Hello from Express server",
    };
    res.status(200).json(response);
});

module.exports = router;