document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");

  if (!token) {
    // No token → send back to login
    window.location.href = "login.html";
    return;
  }

  fetch("http://localhost:5000/me", {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => {
      if (!res.ok) {
        throw new Error("Unauthorized");
      }
      return res.json();
    })
    .then(user => {
      // Fill the HTML with user details
      document.getElementById("userName").textContent = user.name;
      document.getElementById("userEmail").textContent = user.email;
      document.getElementById("userRole").textContent = user.role;
    })
    .catch(err => {
      console.error(err);
      // Token expired or invalid → log out
      localStorage.removeItem("token");
      window.location.href = "login.html";
    });
});

// Logout function
function logout() {
  localStorage.removeItem("token");
  window.location.href = "login.html";
}
