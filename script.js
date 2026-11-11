function rateAnswer(type) {
  const result = document.getElementById("rating-result");
  if (type === "up") {
    result.textContent = "You rated this answer 👍";
  } else {
    result.textContent = "You rated this answer 👎";
  }
  // Optional: Send to backend using fetch() for tracking
}
