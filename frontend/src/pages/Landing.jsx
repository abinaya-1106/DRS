import "../styles/landing.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [isConnecting, setIsConnecting] = useState(false);

  const [registerData, setRegisterData] = useState({
    username: "",
    phone: "",
  });

  const handleRegisterChange = (e) => {
    setRegisterData({ ...registerData, [e.target.name]: e.target.value });
  };

  const connectMetaMask = async () => {
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install MetaMask to continue.");
      window.open("https://metamask.io/download/", "_blank");
      return null;
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    return accounts[0];
  };

  const getNonce = async () => {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/nonce`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || "Failed to get nonce.");
    }
    const { nonce } = await res.json();
    return nonce;
  };

  const signMessage = async (address, nonce) => {
    const message = `Sign in to Realtor. Nonce: ${nonce}`;
    const signedMessage = await window.ethereum.request({
      method: "personal_sign",
      params: [message, address],
    });
    return { message, signedMessage };
  };

  const handleLogin = async () => {
    try {
      setIsConnecting(true);
      const address = await connectMetaMask();
      if (!address) return;

      const nonce = await getNonce();
      const { message, signedMessage } = await signMessage(address, nonce);

      const loginRes = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, signedMessage, message }),
      });

      if (!loginRes.ok) {
        const err = await loginRes.json();
        throw new Error(err.message || "Login failed. Please register first.");
      }

      const data = await loginRes.json();
      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("role", data.user.role);
      sessionStorage.setItem("user", JSON.stringify(data.user));

      const role = data.user.role.toUpperCase();
      if (role === "TENANT") {
        navigate("/tenant-dashboard");
      } else if (role === "LANDLORD") {
        navigate("/landlord-dashboard");
      } else if (role === "ADMIN") {
        navigate("/admin-dashboard");
      }
    } catch (err) {
      console.error("Login error:", err);
      alert(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleRegister = async (role) => {
    if (!registerData.username.trim()) {
      alert("Please enter a username.");
      return;
    }
    if (!registerData.phone.trim()) {
      alert("Please enter a phone number.");
      return;
    }

    try {
      setIsConnecting(true);
      const address = await connectMetaMask();
      if (!address) return;

      const nonce = await getNonce();
      const { message, signedMessage } = await signMessage(address, nonce);

      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          signedMessage,
          message,
          username: registerData.username,
          phone: registerData.phone,
          role,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Registration failed.");
      }

      alert("Registration successful! Please login with MetaMask.");
      setAuthMode("login");
      setRegisterData({ username: "", phone: "" });
    } catch (err) {
      console.error("Registration error:", err);
      alert(err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="landing-page">
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="login-modal" onClick={(e) => e.stopPropagation()}>
            {authMode === "login" ? (
              <>
                <h2>Login</h2>
                <div className="metamask-info">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="MetaMask" className="metamask-logo" />
                  <p>Connect your MetaMask wallet to sign in securely.</p>
                </div>
                <button className="login-btn metamask-btn" onClick={handleLogin} disabled={isConnecting}>
                  {isConnecting ? "Connecting..." : (
                    <>
                      <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="" className="btn-metamask-icon" />
                      Sign in with MetaMask
                    </>
                  )}
                </button>
                <p className="register-text">
                  No account? <span onClick={() => setAuthMode("register")}>Register</span>
                </p>
              </>
            ) : (
              <>
                <h2>Register</h2>
                <div className="metamask-info">
                  <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="MetaMask" className="metamask-logo" />
                  <p>Fill in your details, then connect MetaMask to complete registration.</p>
                </div>
                <input
                  type="text"
                  name="username"
                  placeholder="Username"
                  value={registerData.username}
                  onChange={handleRegisterChange}
                />
                <input
                  type="text"
                  name="phone"
                  placeholder="Phone number"
                  value={registerData.phone}
                  onChange={handleRegisterChange}
                />
                <div className="register-buttons">
                  <button className="login-btn" onClick={() => handleRegister("tenant")} disabled={isConnecting}>
                    {isConnecting ? "Connecting..." : (
                      <>
                        <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="" className="btn-metamask-icon" />
                        Register as Tenant
                      </>
                    )}
                  </button>
                  <button className="login-btn secondary" onClick={() => handleRegister("landlord")} disabled={isConnecting}>
                    {isConnecting ? "Connecting..." : (
                      <>
                        <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" alt="" className="btn-metamask-icon" />
                        Register as Landlord
                      </>
                    )}
                  </button>
                </div>
                <p className="register-text">
                  Already have an account? <span onClick={() => setAuthMode("login")}>Login</span>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}