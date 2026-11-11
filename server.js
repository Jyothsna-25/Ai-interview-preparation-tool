
// ---------- Imports ----------
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import mongoose from "mongoose";

// ---------- Config ----------
dotenv.config();
const app = express();
const PORT = 5000;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ---------- MongoDB Connection ----------
mongoose.connect("mongodb://127.0.0.1:27017/signupApp", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB connection error:", err));

// ---------- MongoDB Models ----------
const User = mongoose.model("User", new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: String,
  experience: Number,
  skillLevel: String,
  resume: String,
  questionsPracticed: { type: Number, default: 0 },
  lastInterviewScore: { type: Number, default: 0 },
  streak: {
    count: { type: Number, default: 0 },
    lastActive: { type: Date, default: null }
  }
}));

const Progress = mongoose.model("Progress", new mongoose.Schema({
  userId: String,
  page: String,
  question: String,
  answer: String,
  isCorrect: Boolean,
  attemptedAt: { type: Date, default: Date.now }
}));

// ---------- Gemini API Configuration ----------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in .env file");
  process.exit(1);
}

// ---------- Reusable Gemini Request with Retries ----------
async function requestGemini(prompt) {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }]
              }
            ]
          })
        }
      );

      const raw = await response.text();

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        data = { error: raw };
      }

      // Successful response
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          data
        };
      }

      // Retry only temporary errors
      const retryable = [429, 500, 502, 503, 504]
        .includes(response.status);

      if (!retryable || attempt === maxRetries) {
        return {
          ok: false,
          status: response.status,
          data
        };
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * Math.pow(2, attempt);

      console.log(
        `⚠️ Gemini returned ${response.status}. ` +
        `Retry ${attempt + 1}/${maxRetries} in ${delay / 1000} seconds.`
      );

      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (err) {
      console.error("❌ Gemini network error:", err.message);

      if (attempt === maxRetries) {
        return {
          ok: false,
          status: 502,
          data: {
            error: "Unable to connect to Gemini API after retries."
          }
        };
      }

      const delay = 1000 * Math.pow(2, attempt);

      console.log(
        `⚠️ Network retry ${attempt + 1}/${maxRetries} ` +
        `in ${delay / 1000} seconds.`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ---------- Gemini API Route ----------
app.post("/api/gemini", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      error: "Invalid or missing prompt"
    });
  }

  try {
    const fullPrompt = `${prompt}

Return the response as a single, valid JSON object.
The JSON should have a key 'questions' which is an array of objects.
Each object in the array must have a 'question' key and an 'answer' key.
Do not include any other text, code, or explanation outside of the JSON block.`;

    const result = await requestGemini(fullPrompt);

    if (!result.ok) {
      console.error(
        "❌ Gemini API error:",
        JSON.stringify(result.data, null, 2)
      );

      return res.status(result.status).json({
        error: result.data
      });
    }

    const data = result.data;

    const rawText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let parsedData;

    // Extract JSON if Gemini returns a Markdown code block
    const jsonString = rawText.match(
      /```(?:json)?\s*([\s\S]*?)```/
    );

    try {
      if (jsonString && jsonString[1]) {
        parsedData = JSON.parse(jsonString[1].trim());
      } else {
        parsedData = JSON.parse(rawText.trim());
      }
    } catch (parseErr) {
      console.error(
        "🚫 JSON parse error:",
        parseErr,
        "Raw:",
        rawText
      );

      return res.status(500).json({
        error: "Invalid JSON returned from Gemini"
      });
    }

    return res.json(parsedData);

  } catch (err) {
    console.error("🚫 Server error:", err);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
});

// ---------- Generate Route ----------
app.post("/generate", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({
      error: "Invalid or missing prompt"
    });
  }

  try {
    const result = await requestGemini(prompt);

    console.log(
      "🔎 Gemini raw response:",
      JSON.stringify(result.data, null, 2)
    );

    if (!result.ok) {
      console.error("❌ Gemini generation failed");

      return res.status(result.status).json({
        error: result.data
      });
    }

    const data = result.data;

    const answer =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!answer) {
      return res.status(500).json({
        error: "No answer generated from Gemini."
      });
    }

    return res.json({
      response: answer
    });

  } catch (err) {
    console.error("🚫 Server error:", err);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
});

// ---------- Answer Evaluation ----------
app.post("/evaluate", (req, res) => {
  console.log("📥 Incoming request body:", req.body);

  const { answer } = req.body;

  if (!answer || typeof answer !== "string") {
    return res.status(400).json({
      error: "Invalid or missing answer"
    });
  }

  // Mock scoring logic
  const score = Math.min(
    10,
    Math.floor(answer.length / 20)
  ) + 1;

  const feedback = score >= 7
    ? "Great answer! You explained your thoughts well."
    : "Try to elaborate more and cover key concepts.";

  res.json({ score, feedback });
});

// ---------- Auth Routes ----------

// Signup
app.post("/signup", async (req, res) => {
  const {
    name,
    email,
    password,
    role,
    experience,
    skillLevel
  } = req.body;

  try {
    const existing = await User.findOne({ email });

    if (existing) {
      return res.json({
        success: false,
        message: "Email already registered!"
      });
    }

    const newUser = new User({
      name,
      email,
      password,
      role,
      experience,
      skillLevel
    });

    await newUser.save();

    res.json({
      success: true,
      message: "Signup successful!"
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error during signup"
    });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({
        success: false,
        message: "User not found"
      });
    }

    if (user.password !== password) {
      return res.json({
        success: false,
        message: "Incorrect password"
      });
    }

    // Streak update
    const today = new Date();

    const lastActive = user.streak.lastActive
      ? new Date(user.streak.lastActive)
      : null;

    const todayMid = new Date(today);
    todayMid.setHours(0, 0, 0, 0);

    if (lastActive) {
      const lastMid = new Date(lastActive);
      lastMid.setHours(0, 0, 0, 0);

      const diffDays = Math.floor(
        (todayMid - lastMid) / (1000 * 60 * 60 * 24)
      );

      if (diffDays === 1) {
        user.streak.count += 1;
      } else if (diffDays > 1) {
        user.streak.count = 1;
      }
    } else {
      user.streak.count = 1;
    }

    user.streak.lastActive = today;

    await user.save();

    res.json({
      success: true,
      message: "Login successful",
      streak: user.streak.count
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error during login"
    });
  }
});

// Reset Password
app.post("/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({
        success: false,
        message: "Email not found"
      });
    }

    user.password = newPassword;

    await user.save();

    res.json({
      success: true,
      message: "Password updated successfully"
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error during password reset"
    });
  }
});

// ---------- User Routes ----------

// Get user by email
app.get("/user/:userId", async (req, res) => {
  try {
    const user = await User.findOne({
      email: req.params.userId
    }).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.json(user);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error"
    });
  }
});

// User progress summary
app.get("/user-progress-summary/:userId", async (req, res) => {
  try {
    const all = await Progress.find({
      userId: req.params.userId
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayProgress = await Progress.find({
      userId: req.params.userId,
      attemptedAt: { $gte: today }
    });

    const correct = all.filter(p => p.isCorrect).length;

    res.json({
      total: all.length,
      correct,
      xp: correct * 10,
      streak: todayProgress.length > 0 ? 1 : 0
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error"
    });
  }
});

// Get user profile
app.get("/me", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({
      message: "Missing email"
    });
  }

  try {
    const user = await User.findOne({ email })
      .select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.json(user);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error"
    });
  }
});

// Update user profile
app.put("/me", async (req, res) => {
  const email = req.query.email;

  if (!email) {
    return res.status(400).json({
      message: "Missing email"
    });
  }

  const {
    name,
    role,
    experience,
    skillLevel
  } = req.body;

  try {
    const updatedUser = await User.findOneAndUpdate(
      { email },
      { name, role, experience, skillLevel },
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.json(updatedUser);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Server error"
    });
  }
});

// Update practice count
app.put("/user/practice-count", async (req, res) => {
  try {
    const { email, practiced } = req.body;

    if (
      !email ||
      !Number.isInteger(practiced) ||
      practiced <= 0
    ) {
      return res.status(400).json({
        message: "Valid email and positive practiced count required"
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    user.questionsPracticed =
      (user.questionsPracticed || 0) + practiced;

    await user.save();

    res.json({
      message: "Questions practiced updated",
      questionsPracticed: user.questionsPracticed
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Internal Server Error"
    });
  }
});

// Save interview score
app.post("/save-score", async (req, res) => {
  const { email, score } = req.body;

  if (!email || score === undefined) {
    return res.status(400).json({
      error: "Email & score required"
    });
  }

  try {
    const user = await User.findOneAndUpdate(
      { email },
      { lastInterviewScore: score },
      { new: true, upsert: true }
    );

    res.json({
      message: "Score saved!",
      user
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// Get streak
app.post("/get-streak", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Email required"
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ streak: 0 });
    }

    const today = new Date();
    const todayStr = today.toDateString();

    if (!user.streak.lastActive) {
      user.streak.count = 1;
      user.streak.lastActive = today;

    } else {
      const lastDateStr =
        new Date(user.streak.lastActive).toDateString();

      if (lastDateStr !== todayStr) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastDateStr === yesterday.toDateString()) {
          user.streak.count += 1;
        } else {
          user.streak.count = 1;
        }

        user.streak.lastActive = today;
      }
    }

    await user.save();

    res.json({
      streak: user.streak.count
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
