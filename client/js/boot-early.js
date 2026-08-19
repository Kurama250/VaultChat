try {
  if (sessionStorage.getItem("shard-key")) {
    document.documentElement.classList.add("session-resume");
  }
} catch {
}
