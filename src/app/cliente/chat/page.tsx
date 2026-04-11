import { redirect } from "next/navigation";

export default function ClienteChatRedirect() {
  redirect("/chat");
}


// 🔥 PATCH PRO MOBILE LAYOUT
// añade contenedor principal:
<div style={{
  maxWidth: 480,
  margin: "0 auto",
  height: "100vh",
  display: "flex",
  flexDirection: "column"
}} />
