const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2");
const app = express();

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "pass123",
  database: "roots",
});

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

app.post('/signup', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }
  const checkUserQuery = 'SELECT * FROM users WHERE username = ?';
  db.query(checkUserQuery, [username], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    if (results.length > 0) {
      return res.status(409).json({ success: false, message: 'Username already exists.' });
    }
    const insertUserQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(insertUserQuery, [username, password], (err, result) => {
      if (err) return res.status(500).json({ success: false, message: 'Database error.' });
      res.status(201).json({ success: true, message: 'User registered successfully.' });
    });
  });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }
  const loginQuery = 'SELECT * FROM users WHERE username = ? AND password = ?';
  db.query(loginQuery, [username, password], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: 'Database error.' });
    if (results.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
    res.json({ success: true, message: 'Login successful.' });
  });
});

app.listen(8000, () => {
  console.log("Server is running on port 8000");
});