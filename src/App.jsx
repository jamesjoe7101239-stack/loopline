import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, updateDoc, collection, addDoc, onSnapshot,
  query, orderBy, limit, arrayUnion, arrayRemove, serverTimestamp,
} from "firebase/firestore";
import { Heart, MessageCircle, UserPlus, UserCheck, LogOut, Image as ImageIcon, Send, Search, Home, User, X } from "lucide-react";

function compressImage(file, maxWidth = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function timeAgo(ts) {
  if (!ts) return "just now";
  const ms = ts.toMillis ? ts.toMillis() : ts;
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

export default function App() {
  const [authUser, setAuthUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [users, setUsers] = useState({});
  const [posts, setPosts] = useState([]);
  const [view, setView] = useState("feed");
  const [profileTarget, setProfileTarget] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  useEffect(() => onAuthStateChanged(auth, (u) => setAuthUser(u)), []);

  useEffect(() => {
    if (!authUser) { setProfile(null); return; }
    return onSnapshot(doc(db, "users", authUser.uid), (snap) => {
      if (snap.exists()) setProfile({ uid: authUser.uid, ...snap.data() });
    });
  }, [authUser]);

  useEffect(() => {
    return onSnapshot(collection(db, "users"), (snap) => {
      const next = {};
      snap.forEach((d) => { next[d.id] = { uid: d.id, ...d.data() }; });
      setUsers(next);
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "posts"), orderBy("timestamp", "desc"), limit(100));
    return onSnapshot(q, (snap) => {
      setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const handleSignup = async ({ email, password, name, username }) => {
    setError("");
    try {
      const uname = username.trim().toLowerCase();
      if (!uname || !name.trim()) { setError("Fill in all fields."); return; }
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, "users", cred.user.uid), {
        username: uname, name: name.trim(), bio: "", followers: [], following: [], createdAt: serverTimestamp(),
      });
      showToast("Welcome, " + name.trim() + "!");
    } catch (e) { setError(e.message.replace("Firebase: ", "")); }
  };

  const handleLogin = async ({ email, password }) => {
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) { setError(e.message.replace("Firebase: ", "")); }
  };

  const handleLogout = async () => { await signOut(auth); setView("feed"); };

  const createPost = async ({ text, imageBase64 }) => {
    await addDoc(collection(db, "posts"), {
      authorUid: authUser.uid, text, imageBase64: imageBase64 || "", timestamp: serverTimestamp(), likes: [], comments: [],
    });
  };

  const toggleLike = async (post) => {
    const ref = doc(db, "posts", post.id);
    const liked = post.likes.includes(authUser.uid);
    await updateDoc(ref, { likes: liked ? arrayRemove(authUser.uid) : arrayUnion(authUser.uid) });
  };

  const addComment = async (post, text) => {
    if (!text.trim()) return;
    const ref = doc(db, "posts", post.id);
    await updateDoc(ref, {
      comments: arrayUnion({ authorUid: authUser.uid, text: text.trim(), ts: Date.now() }),
    });
  };

  const toggleFollow = async (targetUid) => {
    if (!profile || targetUid === profile.uid) return;
    const isFollowing = (profile.following || []).includes(targetUid);
    await updateDoc(doc(db, "users", profile.uid), {
      following: isFollowing ? arrayRemove(targetUid) : arrayUnion(targetUid),
    });
    await updateDoc(doc(db, "users", targetUid), {
      followers: isFollowing ? arrayRemove(profile.uid) : arrayUnion(profile.uid),
    });
  };

  if (authUser === undefined) {
    return <div style={styles.loadingScreen}><div style={styles.loadingLogo}>loopline</div></div>;
  }

  if (!authUser || !profile) {
    return <AuthScreen mode={authMode} setMode={setAuthMode} onLogin={handleLogin} onSignup={handleSignup} error={error} loadingProfile={!!authUser && !profile} />;
  }

  const followingSet = new Set(profile.following || []);
  const feedPosts = posts.filter((p) => p.authorUid === profile.uid || followingSet.has(p.authorUid));
  const displayPosts = feedPosts.length ? feedPosts : posts;

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <TopBar me={profile} view={view} setView={setView} onLogout={handleLogout} setProfileTarget={setProfileTarget} />
      {toast && <div style={styles.toast}>{toast}</div>}
      <div style={styles.main}>
        {view === "feed" && (
          <FeedView posts={displayPosts} users={users} me={profile} onCreate={createPost} onLike={toggleLike} onComment={addComment}
            onOpenProfile={(uid) => { setProfileTarget(uid); setView("profile"); }} isFiltered={feedPosts.length > 0} />
        )}
        {view === "search" && (
          <SearchView users={users} me={profile} onOpenProfile={(uid) => { setProfileTarget(uid); setView("profile"); }} onToggleFollow={toggleFollow} />
        )}
        {view === "profile" && (
          <ProfileView uid={profileTarget || profile.uid} users={users} me={profile} posts={posts}
            onToggleFollow={toggleFollow} onLike={toggleLike} onComment={addComment}
            onOpenProfile={(uid) => { setProfileTarget(uid); setView("profile"); }}
            onSaveProfile={async (fields) => { await updateDoc(doc(db, "users", profile.uid), fields); }} />
        )}
      </div>
    </div>
  );
}

function AuthScreen({ mode, setMode, onLogin, onSignup, error, loadingProfile }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "login") await onLogin({ email, password });
    else await onSignup({ email, password, name, username });
    setBusy(false);
  };

  return (
    <div style={styles.authWrap}>
      <style>{globalCss}</style>
      <div style={styles.authCard}>
        <div style={styles.authLogo}>loopline</div>
        <div style={styles.authTag}>a small, honest place to share what's going on.</div>
        {loadingProfile ? (
          <div style={{ textAlign: "center", marginTop: 20, color: "#B8BEDA" }}>Setting things up...</div>
        ) : (
        <form onSubmit={submit} style={{ marginTop: 24 }}>
          {mode === "signup" && (
            <>
              <input style={styles.input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              <input style={styles.input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </>
          )}
          <input style={styles.input} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={styles.input} placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div style={styles.errorText}>{error}</div>}
          <button style={styles.primaryBtn} type="submit" disabled={busy}>
            {busy ? "..." : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        )}
        <div style={styles.switchRow}>
          {mode === "login" ? (<>No account? <span style={styles.link} onClick={() => setMode("signup")}>Sign up</span></>)
                             : (<>Already have one? <span style={styles.link} onClick={() => setMode("login")}>Log in</span></>)}
        </div>
        <div style={styles.authNote}>Accounts and passwords are handled by Firebase Authentication.</div>
      </div>
    </div>
  );
}

function TopBar({ me, view, setView, onLogout, setProfileTarget }) {
  return (
    <div style={styles.topBar}>
      <div style={styles.topBarLogo} onClick={() => setView("feed")}>loopline</div>
      <div style={styles.topBarIcons}>
        <button style={iconBtnStyle(view === "feed")} onClick={() => setView("feed")}><Home size={20} /></button>
        <button style={iconBtnStyle(view === "search")} onClick={(
