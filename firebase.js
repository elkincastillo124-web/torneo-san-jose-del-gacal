import { initializeApp } from
"https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from
"https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  onValue,
  set
} from
"https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCfgV9mDOv6KL487E-h2jyPkRACeHLnkvo",
  authDomain: "torneosanjosedelgacal.firebaseapp.com",
  databaseURL: "https://torneosanjosedelgacal-default-rtdb.firebaseio.com",
  projectId: "torneosanjosedelgacal",
  storageBucket: "torneosanjosedelgacal.firebasestorage.app",
  messagingSenderId: "37839694828",
  appId: "1:37839694828:web:2615aeeee272a7b0bc2ec9",
  measurementId: "G-140DCJJWED"
};

export const ADMIN_UID =
"pSl2VosT9RSmzAJ0kM51GZFqfv32";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export const torneoRef = ref(db, "torneo");

export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  onValue,
  set
};

export const equiposIniciales = [
  "Los Titanes",
  "Deportivo Central",
  "Real Fútbol",
  "Los Guerreros",
  "Atlético Gacal",
  "Juventus",
  "La 10 FC",
  "Deportivo San José"
];

export function datosIniciales() {
  return {
    teams: equiposIniciales,
    groupDraw: null,
    matches: [],
    upcoming: [],
    liveUrl: "",
    timer: {
      seconds: 0,
      startedAt: null,
      active: false
    }
  };
}