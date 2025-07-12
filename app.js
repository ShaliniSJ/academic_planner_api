const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2");
const app = express();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const mysql2 = require("mysql2/promise");
require("dotenv").config();

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "pass123",
  database: "academic_planner",
});

app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-flash",
  apiKey: process.env.GOOGLE_API_KEY,
});

const dbConfig = {
  host: "localhost",
  user: "root",
  password: "pass123",
  database: "academic_planner",
};

async function fetchRelevantContext() {
  // Example: fetch assignments and exams as context
  const connection = await mysql2.createConnection(dbConfig);
  const [assignments] = await connection.execute(
    "SELECT * FROM assignments ORDER BY due_date DESC LIMIT 5"
  );
  const [assignment_student] = await connection.execute(
    "SELECT * FROM assignment_student"
  );
  const [exams] = await connection.execute(
    "SELECT * FROM exams ORDER BY exam_date DESC LIMIT 5"
  );
  const [exam_student] = await connection.execute("SELECT * FROM exam_student");

  const [classes] = await connection.execute("SELECT * FROM classes");
  const [class_course] = await connection.execute("SELECT * FROM class_course");
  const [users] = await connection.execute(
    "SELECT *  FROM users WHERE is_admin = 0"
  );
  await connection.end();
  return {
    assignments,
    assignment_student,
    exams,
    exam_student,
    classes,
    class_course,
    users,
  };
}

app.post("/rag/query", async (req, res) => {
  const { query: userQuery } = req.body;
  if (!userQuery) {
    return res
      .status(400)
      .json({ success: false, message: "Query is required." });
  }
  try {
    // 1. Retrieve context from MySQL
    const context = await fetchRelevantContext();
    // 2. Compose prompt for Gemini
    const prompt = `
You are an academic assistant. Here is some context from the database:
Assignments: ${JSON.stringify(context.assignments)}
Exams: ${JSON.stringify(context.exams)}
students: ${JSON.stringify(context.users)}
Classes: ${JSON.stringify(context.classes)}
Assignment-Student Relations: ${JSON.stringify(context.assignment_student)}
Exam-Student Relations: ${JSON.stringify(context.exam_student)}
Class-Course Relations: ${JSON.stringify(context.class_course)}
User question: ${userQuery}
Answer the user's question using the context above if the user query is out of context just reply "this question is out of topic so i cannot help".
    `;
    // 3. Get answer from Gemini
    const response = await llm.invoke(prompt);
    res.json({
      success: true,
      query: userQuery,
      response: response.content,
      context,
    });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, message: "RAG error", error: err.message });
  }
});

app.post("/signup", (req, res) => {
  const {
    first_name,
    last_name,
    email,
    password,
    roll_no,
    phone,
    course,
    date_of_birth,
  } = req.body;
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({
      success: false,
      message: "First name, last name, email, and password are required.",
    });
  }
  const checkUserQuery = "SELECT * FROM users WHERE email = ?";
  db.query(checkUserQuery, [email], (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error checking user." });
    }
    if (results.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "Email already exists." });
    }
    const insertUserQuery =
      "INSERT INTO users (first_name, last_name, email, password, roll_no, phone, course, date_of_birth, registered_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURDATE())";
    db.query(
      insertUserQuery,
      [
        first_name,
        last_name,
        email,
        password,
        roll_no,
        phone,
        course,
        date_of_birth,
      ],
      (err, result) => {
        if (err) {
          console.error(err);
          return res.status(500).json({
            success: false,
            message: "Database error registering user.",
          });
        }
        res.status(201).json({
          success: true,
          message: "User registered successfully.",
          userId: result.insertId,
        });
      }
    );
  });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "email and password are required.",
    });
  }
  const loginQuery = "SELECT * FROM users WHERE email = ? AND password = ?";
  db.query(loginQuery, [email, password], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "Database error." });
    }
    if (results.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }
    const user = results[0];
    return res.json({
      success: true,
      data: {
        id: user.id,
        is_admin: user.is_admin,
      },
    });
  });
});

app.get("/students", (req, res) => {
  const query =
    "SELECT id, roll_no, first_name, last_name, email, phone, course, registered_date, date_of_birth FROM users WHERE is_admin = 0";
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error.",
      });
    }
    res.json({ success: true, data: results });
  });
});

app.put("/students/:id", (req, res) => {
  const { id } = req.params;
  let { first_name, last_name, email, phone, course, roll_no, date_of_birth } =
    req.body;
  date_of_birth = date_of_birth ? new Date(date_of_birth) : null;
  const query =
    "UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, course = ?, roll_no = ?, date_of_birth = ? WHERE id = ?";
  db.query(
    query,
    [first_name, last_name, email, phone, course, roll_no, date_of_birth, id],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: "Database error updating student.",
        });
      }
      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Student not found." });
      }
      res
        .status(200)
        .json({ success: true, message: `Student ${id} updated successfully` });
    }
  );
});

app.delete("/students/:id", (req, res) => {
  const { id } = req.params;
  const query = "DELETE FROM users WHERE id = ? AND is_admin = 0";
  db.query(query, [id], (err, result) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error deleting student." });
    }
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found or is an admin." });
    }
    res
      .status(200)
      .json({ success: true, message: `Student ${id} deleted successfully` });
  });
});

app.get("/assignments/:id", (req, res) => {
  console.log("Fetching assignment with ID:", req.params.id);
  const { id } = req.params;
  const assignment_ids =
    "SELECT * FROM assignment_student WHERE student_id = ?";
  db.query(assignment_ids, [id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error fetching assignments.",
      });
    }
    if (results.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No assignments found for this student.",
      });
    }
    const assignmentIds = results.map((row) => row.assignment_id);
    const query = "SELECT * FROM assignments WHERE id IN (?) ORDER BY due_date";
    db.query(query, [assignmentIds], (err, assignmentResults) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: "Database error fetching assignments.",
        });
      }
      res.json({ success: true, data: assignmentResults });
    });
  });
});

app.get("/assignments", (req, res) => {
  const query = "SELECT * FROM assignments ORDER BY due_date";
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error fetching assignments.",
      });
    }
    res.json({ success: true, data: results });
  });
});

app.post("/assignments", (req, res) => {
  const { title, description, due_date, course } = req.body;
  if (!title || !due_date || !course) {
    return res.status(400).json({
      success: false,
      message: "Title, due date, and course are required.",
    });
  }
  const query =
    "INSERT INTO assignments (title, description, due_date, course) VALUES (?, ?, ?, ?)";
  db.query(query, [title, description, due_date, course], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error creating assignment.",
      });
    }
    res.status(201).json({
      success: true,
      message: "Assignment created successfully",
      assignmentId: result.insertId,
    });
  });
});

app.post("/assign", (req, res) => {
  const { assignment_id, student_id } = req.body;
  if (!assignment_id || !student_id) {
    return res.status(400).json({
      success: false,
      message: "Assignment ID and Student ID are required.",
    });
  }
  const query =
    "INSERT INTO assignment_student (assignment_id, student_id) VALUES (?, ?)";
  db.query(query, [assignment_id, student_id], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error assigning assignment.",
      });
    }
    res
      .status(200)
      .json({ success: true, message: "Assignment assigned successfully" });
  });
});

app.get("/exams", (req, res) => {
  const query = "SELECT * FROM exams ORDER BY exam_date";
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error fetching exams." });
    }
    res.json({ success: true, data: results });
  });
});

app.post("/exams", (req, res) => {
  const { title, exam_date, course } = req.body;
  if (!title || !exam_date || !course) {
    return res.status(400).json({
      success: false,
      message: "Title, exam date, and course are required.",
    });
  }
  const query = "INSERT INTO exams (title, exam_date, course) VALUES (?, ?, ?)";
  db.query(query, [title, exam_date, course], (err, result) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error creating exam." });
    }
    res.status(201).json({
      success: true,
      message: "Exam created successfully",
      examId: result.insertId,
    });
  });
});

app.post("/exams/assign", (req, res) => {
  const { exam_id, student_id } = req.body;
  if (!exam_id || !student_id) {
    return res.status(400).json({
      success: false,
      message: "Exam ID and Student ID are required.",
    });
  }
  const query = "INSERT INTO exam_student (exam_id, student_id) VALUES (?, ?)";
  db.query(query, [exam_id, student_id], (err, result) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error assigning exam." });
    }
    res
      .status(200)
      .json({ success: true, message: "Exam assigned successfully" });
  });
});

app.get("/classes", (req, res) => {
  const query = "SELECT * FROM classes";
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error fetching classes." });
    }
    res.json({ success: true, data: results });
  });
});

app.post("/classes", (req, res) => {
  const { name, instructor, time, location, course } = req.body;
  if (!name || !instructor || !time || !location || !course) {
    return res
      .status(400)
      .json({ success: false, message: "All class fields are required." });
  }
  const query =
    "INSERT INTO classes (name, instructor, time, location, course) VALUES (?, ?, ?, ?, ?)";
  db.query(query, [name, instructor, time, location, course], (err, result) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error creating class." });
    }
    res.status(201).json({
      success: true,
      message: "Class created successfully",
      classId: result.insertId,
    });
  });
});

app.post("/classes/assign", (req, res) => {
  const { class_id, course } = req.body;
  if (!class_id || !course) {
    return res
      .status(400)
      .json({ success: false, message: "Class ID and course are required." });
  }
  const query = "INSERT INTO class_course (class_id, course) VALUES (?, ?)";
  db.query(query, [class_id, course], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error assigning class to course.",
      });
    }
    res.status(200).json({
      success: true,
      message: `Class assigned to ${course} successfully`,
    });
  });
});

app.get("/student/:id/exams", (req, res) => {
  const { id } = req.params;
  const query = `
      SELECT e.id, e.title, e.exam_date, e.course, es.status 
      FROM exams e
      JOIN exam_student es ON e.id = es.exam_id
      WHERE es.student_id = ? AND e.exam_date >= CURDATE()
      ORDER BY e.exam_date`;
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error fetching exams." });
    }
    res.status(200).json({ success: true, data: results });
  });
});

app.get("/student/:id/assignments", (req, res) => {
  const { id } = req.params;
  const query = `
      SELECT a.id, a.title, a.description, a.due_date, a.course, AsS.status 
      FROM assignments a
      JOIN assignment_student AsS ON a.id = AsS.assignment_id
      WHERE AsS.student_id = ?
      ORDER BY a.due_date`;
  db.query(query, [id], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error fetching assignments.",
      });
    }
    res.status(200).json({ success: true, data: results });
  });
});

app.get("/student/:id/classes", (req, res) => {
  const { id } = req.params;
  const studentCourseQuery = "SELECT course FROM users WHERE id = ?";
  db.query(studentCourseQuery, [id], (err, studentResults) => {
    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Database error fetching student course.",
      });
    }
    if (studentResults.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found." });
    }
    const studentCourse = studentResults[0].course;
    if (!studentCourse) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "Student is not enrolled in any course.",
      });
    }
    const classesQuery = "SELECT * FROM classes WHERE course = ?";
    db.query(classesQuery, [studentCourse], (err, classResults) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          success: false,
          message: "Database error fetching classes.",
        });
      }
      res.status(200).json({ success: true, data: classResults });
    });
  });
});

app.get("/courses", (req, res) => {
  const query = "SELECT * FROM courses";
  db.query(query, (err, results) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error." });
    }
    res.json({ success: true, data: results });
  });
});

app.listen(8000, () => {
  console.log("Server is running on port 8000");
});
