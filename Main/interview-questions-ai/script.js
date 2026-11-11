let questions = [];
let current = 0;
let answers = [];
let confidence = [];

async function fetchQuestions(role = "Frontend Developer") {
  try {
    const response = await fetch("/generate-questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });

    const data = await response.json();
    if (Array.isArray(data.questions)) {
      questions = data.questions.map(q => ({
        q: q.trim(),
        hint: "Think carefully about this concept."
      }));

      answers = Array(questions.length).fill("");
      confidence = Array(questions.length).fill(0);

      document.getElementById("totalQ").textContent = questions.length;
      loadQuestion();
    } else {
      document.getElementById("questionText").textContent = "Failed to load questions.";
    }
  } catch (err) {
    document.getElementById("questionText").textContent = "Server error.";
    console.error(err);
  }
}

function loadQuestion() {
  if (questions.length === 0) return;
  document.getElementById("questionText").textContent = questions[current].q;
  document.getElementById("hintText").textContent = questions[current].hint;
  document.getElementById("qNum").textContent = current + 1;
  document.getElementById("answerInput").value = answers[current];
  document.getElementById("hintText").style.display = "none";
}

function nextQuestion() {
  saveAnswer();
  if (current < questions.length - 1) {
    current++;
    loadQuestion();
  }
}

function prevQuestion() {
  saveAnswer();
  if (current > 0) {
    current--;
    loadQuestion();
  }
}

function saveAnswer() {
  answers[current] = document.getElementById("answerInput").value;
}

function rate(level) {
  confidence[current] = level;
  alert(`Confidence rated: ${["Low", "Medium", "High"][level - 1]}`);
}

document.getElementById("toggleHint").addEventListener("click", () => {
  const hint = document.getElementById("hintText");
  hint.style.display = hint.style.display === "none" ? "block" : "none";
});

window.onload = () => {
  fetchQuestions("Frontend Developer");
};