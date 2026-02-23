async function login() {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    alert(error.message);
    return;
  }

  const token = data.session?.access_token;
  if (!token) {
    alert("No token");
    return;
  }

  const me = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());

  if (!me?.ok) {
    alert(me?.error || "No role");
    return;
  }

  if (me.role === "admin") window.location.href = "/admin";
  else if (me.role === "central") window.location.href = "/panel-central";
  else window.location.href = "/panel-tarotista";
}
