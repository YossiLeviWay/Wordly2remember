/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Volume2, ChevronRight, RotateCcw, Flame, CheckCircle2, BookOpen, 
  Layout, History, Settings, Play, Plus, Trash2, Save, X, 
  LogOut, LogIn, Grid, FileText, Search, ArrowLeft, MoreVertical,
  Home, Languages
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, 
  query, where, onSnapshot, serverTimestamp, setDoc, getDoc,
  writeBatch
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signInWithGoogle, logOut } from './firebase';
import { cn } from './lib/utils';

// --- Types ---
interface Word {
  id?: string;
  english: string;
  hebrew: string;
  level: number;
  nextReview: number;
  lastReviewed?: number;
  setId?: string;
}

interface WordSet {
  id: string;
  title: string;
  userId: string;
  createdAt: any;
  wordCount: number;
}

// --- Components ---

const Button = ({ children, className, variant = 'primary', ...props }: any) => {
  const variants: any = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200 dark:shadow-none",
    secondary: "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700",
    danger: "bg-red-50 dark:bg-red-900/20 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40",
    ghost: "bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400",
    outline: "bg-transparent border-2 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700"
  };

  return (
    <button 
      className={cn(
        "px-4 py-2 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

const Input = ({ className, ...props }: any) => (
  <input 
    className={cn(
      "w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all",
      className
    )}
    {...props}
  />
);

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'session' | 'editor' | 'summary' | 'smart_list'>('dashboard');
  const [wordSets, setWordSets] = useState<WordSet[]>([]);
  const [globalWords, setGlobalWords] = useState<Word[]>([]);
  const [activeSet, setActiveSet] = useState<WordSet | null>(null);
  const [activeWords, setActiveWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionResults, setSessionResults] = useState<any[]>([]);
  const [streak, setStreak] = useState(0);
  const [frontLang, setFrontLang] = useState<'english' | 'hebrew'>('hebrew');
  const [selectedSmartList, setSelectedSmartList] = useState<string | null>(null);

  // Connection Test
  useEffect(() => {
    const testConnection = async () => {
      try {
        const { getDocFromServer } = await import('firebase/firestore');
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Sync user profile
        const userRef = doc(db, 'users', u.uid);
        setDoc(userRef, {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          lastActive: new Date().toISOString()
        }, { merge: true });

        // Fetch streak
        getDoc(userRef).then(snap => {
          if (snap.exists()) setStreak(snap.data().streak || 0);
        });
      }
    });
    return unsubscribe;
  }, []);

  // Word Sets Listener
  useEffect(() => {
    if (!user) return;
    const path = 'word_sets';
    const q = query(collection(db, path), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snap) => {
      const sets = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as WordSet));
      setWordSets(sets);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsubscribe;
  }, [user]);

  // Global Words Listener
  useEffect(() => {
    if (!user || wordSets.length === 0) {
      setGlobalWords([]);
      return;
    }
    
    const unsubscribes = wordSets.map(set => {
      const wordsRef = collection(db, 'word_sets', set.id, 'words');
      return onSnapshot(wordsRef, (snap) => {
        const setWords = snap.docs.map(d => ({ id: d.id, setId: set.id, ...d.data() } as Word));
        setGlobalWords(prev => {
          const otherWords = prev.filter(w => !snap.docs.some(d => d.id === w.id));
          return [...otherWords, ...setWords];
        });
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [user, wordSets]);

  const smartLists = useMemo(() => {
    const now = Date.now();
    const getDueCount = (level: number) => globalWords.filter(w => w.level === level && (!w.nextReview || w.nextReview <= now)).length;
    const getEasyDueCount = () => globalWords.filter(w => w.level >= 3 && (!w.nextReview || w.nextReview <= now)).length;

    return [
      { id: 'again', title: 'Again', color: 'text-red-500', bg: 'bg-red-50', darkBg: 'dark:bg-red-900/20', icon: RotateCcw, count: globalWords.filter(w => w.level === 0).length, dueCount: getDueCount(0) },
      { id: 'hard', title: 'Hard', color: 'text-orange-500', bg: 'bg-orange-50', darkBg: 'dark:bg-orange-900/20', icon: Flame, count: globalWords.filter(w => w.level === 1).length, dueCount: getDueCount(1) },
      { id: 'good', title: 'Good', color: 'text-green-500', bg: 'bg-green-50', darkBg: 'dark:bg-green-900/20', icon: CheckCircle2, count: globalWords.filter(w => w.level === 2).length, dueCount: getDueCount(2) },
      { id: 'easy', title: 'Easy', color: 'text-blue-500', bg: 'bg-blue-50', darkBg: 'dark:bg-blue-900/20', icon: BookOpen, count: globalWords.filter(w => w.level >= 3).length, dueCount: getEasyDueCount() },
    ];
  }, [globalWords]);

  // TTS Helper
  const speak = useCallback((text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }, []);

  // SRS Logic
  const handleRating = async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    const word = activeWords[currentIndex];
    const now = Date.now();
    
    let interval = 0;
    let newLevel = 0;
    switch (rating) {
      case 'again': interval = 0; newLevel = 0; break; // 0 min
      case 'hard': interval = 2 * 24 * 60 * 60 * 1000; newLevel = 1; break; // 2 days
      case 'good': interval = 4 * 24 * 60 * 60 * 1000; newLevel = 2; break; // 4 days
      case 'easy': interval = 7 * 24 * 60 * 60 * 1000; newLevel = 3; break; // 7 days
    }

    const updatedWord = {
      ...word,
      level: newLevel,
      nextReview: now + interval,
      lastReviewed: now
    };

    // Update in Firestore
    const effectiveSetId = activeSet?.id || word.setId;
    if (effectiveSetId && word.id) {
      const path = `word_sets/${effectiveSetId}/words/${word.id}`;
      try {
        const wordRef = doc(db, 'word_sets', effectiveSetId, 'words', word.id);
        await updateDoc(wordRef, {
          level: updatedWord.level,
          nextReview: updatedWord.nextReview,
          lastReviewed: updatedWord.lastReviewed
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }

    setSessionResults([...sessionResults, { ...word, rating }]);
    
    if (currentIndex < activeWords.length - 1) {
      setIsFlipped(false);
      setCurrentIndex(currentIndex + 1);
    } else {
      setView('summary');
    }
  };

  const startSmartSession = (listId: string) => {
    const now = Date.now();
    const filteredWords = globalWords.filter((w: Word) => {
      const isDue = !w.nextReview || w.nextReview <= now;
      if (!isDue) return false;
      if (listId === 'again') return w.level === 0;
      if (listId === 'hard') return w.level === 1;
      if (listId === 'good') return w.level === 2;
      if (listId === 'easy') return w.level >= 3;
      return false;
    });

    if (filteredWords.length === 0) {
      alert("No words due for review in this list!");
      return;
    }

    setActiveSet(null); // Clear active set for smart session
    setActiveWords(filteredWords);
    setCurrentIndex(0);
    setIsFlipped(false);
    setSessionResults([]);
    setView('session');
  };
    setActiveSet(set);
    const path = `word_sets/${set.id}/words`;
    try {
      const wordsRef = collection(db, 'word_sets', set.id, 'words');
      const snap = await getDocs(wordsRef);
      const allWords = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Word));
      
      // Filter words due for review
      const now = Date.now();
      const dueWords = allWords.filter(w => !w.nextReview || w.nextReview <= now);
      
      if (dueWords.length === 0) {
        alert("No words due for review in this set!");
        return;
      }

      setActiveWords(dueWords);
      setCurrentIndex(0);
      setIsFlipped(false);
      setSessionResults([]);
      setView('session');
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  };

  const openEditor = async (set?: WordSet) => {
    if (set) {
      setActiveSet(set);
      const path = `word_sets/${set.id}/words`;
      try {
        const wordsRef = collection(db, 'word_sets', set.id, 'words');
        const snap = await getDocs(wordsRef);
        setActiveWords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Word)));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    } else {
      setActiveSet(null);
      setActiveWords([{ english: '', hebrew: '', level: 0, nextReview: 0 }]);
    }
    setView('editor');
  };

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log('Sign-in popup closed by user');
      } else {
        console.error('Login error:', error);
        alert('An error occurred during sign-in. Please try again.');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 dark:bg-slate-950 p-6 text-center">
        <div className="w-20 h-20 bg-blue-600 text-white rounded-3xl flex items-center justify-center mb-8 shadow-xl shadow-blue-200 dark:shadow-none">
          <BookOpen className="w-10 h-10" />
        </div>
        <h1 className="text-4xl font-black mb-4 tracking-tight">Wordly 2 remember</h1>
        <p className="text-slate-500 mb-8 max-w-xs">Your personal vocabulary companion. Master new words with spaced repetition.</p>
        <Button onClick={handleLogin} className="w-full max-w-xs py-4 text-lg">
          <LogIn className="w-5 h-5" />
          Sign in with Google
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto h-screen w-full bg-white dark:bg-slate-950 border-x border-slate-100 dark:border-slate-900 shadow-2xl relative overflow-hidden font-sans flex flex-col">
      <AnimatePresence mode="wait">
        {view === 'dashboard' && (
          <motion.div 
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex-1 flex flex-col p-6 overflow-hidden"
          >
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center gap-3">
                <img src={user.photoURL || ''} alt="User" className="w-10 h-10 rounded-full border-2 border-blue-500" />
                <div>
                  <h1 className="text-xl font-bold tracking-tight leading-none">{user.displayName?.split(' ')[0]}</h1>
                  <p className="text-xs text-slate-400">Ready to learn?</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setFrontLang(frontLang === 'english' ? 'hebrew' : 'english')}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 transition-all"
                  title="Toggle front language"
                >
                  <Languages className="w-3 h-3" />
                  {frontLang === 'english' ? 'EN → HE' : 'HE → EN'}
                </button>
                <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-900/20 px-3 py-1.5 rounded-full">
                  <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
                  <span className="font-bold text-orange-600 dark:text-orange-400">{streak}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-900 p-6 rounded-3xl mb-8 flex flex-col items-center text-center border border-slate-100 dark:border-slate-800">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
                <BookOpen className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold mb-1">Your Progress</h2>
              <p className="text-slate-500 mb-6 text-sm">You have {wordSets.length} word sets saved.</p>
              <Button onClick={() => openEditor()} className="w-full">
                <Plus className="w-5 h-5" />
                Create New Set
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-8">
              {smartLists.map(list => (
                <button 
                  key={list.id}
                  onClick={() => {
                    setSelectedSmartList(list.id);
                    setView('smart_list');
                  }}
                  className={cn(
                    "flex flex-col items-center p-3 rounded-2xl transition-all border border-transparent hover:border-blue-200 dark:hover:border-blue-900 relative",
                    list.bg, list.darkBg, list.color
                  )}
                >
                  {list.dueCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full border-2 border-white dark:border-slate-950 font-bold">
                      {list.dueCount}
                    </span>
                  )}
                  <list.icon className="w-5 h-5 mb-1" />
                  <span className="text-[10px] font-bold uppercase tracking-tighter">{list.title}</span>
                  <span className="text-lg font-black">{list.count}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between mb-4 px-2">
              <h3 className="font-bold flex items-center gap-2">
                <Layout className="w-4 h-4" />
                Your Lists
              </h3>
              <button className="text-blue-600 text-sm font-bold">View All</button>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 pb-24">
              {wordSets.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <p>No lists yet. Create your first one!</p>
                </div>
              ) : (
                wordSets.map(set => (
                  <div key={set.id} className="group relative bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl hover:border-blue-200 dark:hover:border-blue-900 transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h4 className="font-bold text-slate-800 dark:text-slate-100">{set.title}</h4>
                        <p className="text-xs text-slate-400">{set.wordCount || 0} words</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditor(set)} className="p-2 text-slate-400 hover:text-blue-500"><Settings className="w-4 h-4" /></button>
                        <button 
                          onClick={async () => {
                            if(confirm("Delete this set?")) {
                              await deleteDoc(doc(db, 'word_sets', set.id));
                            }
                          }} 
                          className="p-2 text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <Button onClick={() => startSession(set)} variant="secondary" className="w-full py-2 text-sm">
                      <Play className="w-4 h-4 fill-current" />
                      Practice
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="absolute bottom-0 left-0 w-full h-20 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-t border-slate-100 dark:border-slate-900 flex items-center justify-around px-8">
              <button className="text-blue-600"><Layout className="w-6 h-6" /></button>
              <button className="text-slate-300 hover:text-slate-400"><History className="w-6 h-6" /></button>
              <button onClick={logOut} className="text-slate-300 hover:text-red-400"><LogOut className="w-6 h-6" /></button>
            </div>
          </motion.div>
        )}

    {view === 'editor' && (
      <SetEditor 
        user={user} 
        activeSet={activeSet} 
        initialWords={activeWords} 
        onClose={() => setView('dashboard')} 
        onHome={() => setView('dashboard')}
      />
    )}

    {view === 'session' && (
      <LearningSession 
        words={activeWords} 
        currentIndex={currentIndex}
        isFlipped={isFlipped}
        setIsFlipped={setIsFlipped}
        onRate={handleRating}
        speak={speak}
        frontLang={frontLang}
        setFrontLang={setFrontLang}
        onHome={() => setView('dashboard')}
      />
    )}

    {view === 'smart_list' && (
      <SmartListView 
        listId={selectedSmartList}
        words={globalWords}
        onHome={() => setView('dashboard')}
        onPractice={() => startSmartSession(selectedSmartList!)}
        speak={speak}
      />
    )}

        {view === 'summary' && (
          <SummaryView 
            results={sessionResults} 
            streak={streak} 
            onFinish={() => setView('dashboard')} 
            onRestart={() => setView('session')} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

function SetEditor({ user, activeSet, initialWords, onClose, onHome }: any) {
  const [title, setTitle] = useState(activeSet?.title || '');
  const [words, setWords] = useState<Word[]>(initialWords);
  const [bulkText, setBulkText] = useState('');
  const [mode, setMode] = useState<'grid' | 'bulk'>('grid');
  const [saving, setSaving] = useState(false);

  const addRow = () => {
    setWords([...words, { english: '', hebrew: '', level: 0, nextReview: 0 }]);
  };

  const updateWord = (index: number, field: keyof Word, value: string) => {
    const newWords = [...words];
    newWords[index] = { ...newWords[index], [field]: value };
    setWords(newWords);
  };

  const removeRow = (index: number) => {
    setWords(words.filter((_, i) => i !== index));
  };

  const handleBulkImport = () => {
    const lines = bulkText.split('\n');
    const newWords: Word[] = lines.map(line => {
      const [english, hebrew] = line.split(/[\t,]/);
      return { 
        english: english?.trim() || '', 
        hebrew: hebrew?.trim() || '', 
        level: 0, 
        nextReview: 0 
      };
    }).filter(w => w.english || w.hebrew);
    
    setWords([...words, ...newWords]);
    setBulkText('');
    setMode('grid');
  };

  const saveSet = async () => {
    if (!title.trim()) return alert("Please enter a title");
    setSaving(true);
    const path = activeSet?.id ? `word_sets/${activeSet.id}` : 'word_sets';
    try {
      let setId = activeSet?.id;
      if (!setId) {
        const setRef = await addDoc(collection(db, 'word_sets'), {
          title,
          userId: user.uid,
          createdAt: serverTimestamp(),
          wordCount: words.length
        });
        setId = setRef.id;
      } else {
        await updateDoc(doc(db, 'word_sets', setId), {
          title,
          wordCount: words.length
        });
      }

      // Batch update words
      const batch = writeBatch(db);
      const wordsRef = collection(db, 'word_sets', setId, 'words');
      
      for (const word of words) {
        if (word.id) {
          batch.update(doc(wordsRef, word.id), {
            english: word.english,
            hebrew: word.hebrew
          });
        } else {
          const newWordRef = doc(wordsRef);
          batch.set(newWordRef, {
            english: word.english,
            hebrew: word.hebrew,
            level: 0,
            nextReview: 0
          });
        }
      }
      await batch.commit();
      onClose();
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div 
      key="editor"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="flex-1 flex flex-col p-6 overflow-hidden"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 -ml-2 text-slate-400 hover:text-slate-600"><ArrowLeft className="w-6 h-6" /></button>
          <h2 className="text-xl font-bold">{activeSet ? 'Edit Set' : 'New Set'}</h2>
        </div>
        <button onClick={onHome} className="p-2 text-slate-400 hover:text-blue-600 transition-colors">
          <Home className="w-6 h-6" />
        </button>
      </div>

      <Input 
        placeholder="Set Title (e.g., TOEFL Vocabulary)" 
        value={title} 
        onChange={(e: any) => setTitle(e.target.value)}
        className="mb-6 text-lg font-bold"
      />

      <div className="flex gap-2 mb-4">
        <Button 
          variant={mode === 'grid' ? 'primary' : 'ghost'} 
          onClick={() => setMode('grid')}
          className="flex-1"
        >
          <Grid className="w-4 h-4" />
          Grid
        </Button>
        <Button 
          variant={mode === 'bulk' ? 'primary' : 'ghost'} 
          onClick={() => setMode('bulk')}
          className="flex-1"
        >
          <FileText className="w-4 h-4" />
          Bulk Paste
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto mb-6">
        {mode === 'grid' ? (
          <div className="space-y-3">
            {words.map((word, i) => (
              <div key={i} className="flex gap-2 items-center">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <Input 
                    placeholder="English" 
                    value={word.english} 
                    onChange={(e: any) => updateWord(i, 'english', e.target.value)}
                  />
                  <Input 
                    placeholder="Hebrew" 
                    value={word.hebrew} 
                    onChange={(e: any) => updateWord(i, 'hebrew', e.target.value)}
                    dir="rtl"
                  />
                </div>
                <button onClick={() => removeRow(i)} className="p-2 text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <Button variant="outline" onClick={addRow} className="w-full border-dashed">
              <Plus className="w-4 h-4" />
              Add Row
            </Button>
          </div>
        ) : (
          <div className="h-full flex flex-col gap-4">
            <p className="text-xs text-slate-400">Paste words separated by tabs or commas. One pair per line.</p>
            <textarea 
              className="flex-1 w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              placeholder="apple, תפוח&#10;banana, בננה"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
            />
            <Button onClick={handleBulkImport} className="w-full">Import Words</Button>
          </div>
        )}
      </div>

      <Button onClick={saveSet} disabled={saving} className="w-full py-4">
        {saving ? 'Saving...' : <><Save className="w-5 h-5" /> Save Set</>}
      </Button>
    </motion.div>
  );
}

function LearningSession({ words, currentIndex, isFlipped, setIsFlipped, onRate, speak, frontLang, setFrontLang, onHome }: any) {
  const card = words[currentIndex];
  const progress = ((currentIndex) / words.length) * 100;

  const frontText = frontLang === 'english' ? card.english : card.hebrew;
  const backText = frontLang === 'english' ? card.hebrew : card.english;
  const isFrontRTL = frontLang === 'hebrew';
  const isBackRTL = frontLang === 'english';

  return (
    <motion.div 
      key="session"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex-1 flex flex-col p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <button onClick={onHome} className="p-2 -ml-2 text-slate-400 hover:text-blue-600 transition-colors">
          <Home className="w-6 h-6" />
        </button>
        <button 
          onClick={() => setFrontLang(frontLang === 'english' ? 'hebrew' : 'english')}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 transition-all"
        >
          <Languages className="w-3.5 h-3.5" />
          {frontLang === 'english' ? 'EN → HE' : 'HE → EN'}
        </button>
      </div>

      <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full mb-8 overflow-hidden">
        <motion.div 
          className="bg-blue-500 h-full" 
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative">
        <motion.div 
          layout
          onClick={() => {
            if(!isFlipped) speak(card.english);
            setIsFlipped(!isFlipped);
          }}
          className={cn(
            "w-full max-w-sm aspect-[4/5] bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center p-10 cursor-pointer transition-all duration-500",
            isFlipped ? "ring-2 ring-blue-500/20" : ""
          )}
        >
          {!isFlipped ? (
            <div className="text-center">
              <p className={cn("text-4xl font-bold tracking-tight text-slate-800 dark:text-slate-100 mb-4", isFrontRTL ? "font-hebrew" : "")} dir={isFrontRTL ? "rtl" : "ltr"}>
                {frontText}
              </p>
              <p className="text-slate-400 text-sm uppercase tracking-widest font-semibold">Tap to Reveal</p>
            </div>
          ) : (
            <div className="text-center">
              <button 
                onClick={(e) => { e.stopPropagation(); speak(card.english); }}
                className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 rounded-full hover:scale-110 transition-transform"
              >
                <Volume2 className="w-8 h-8" />
              </button>
              <p className={cn("text-5xl font-black text-slate-800 dark:text-slate-100 mb-2", isBackRTL ? "font-hebrew" : "")} dir={isBackRTL ? "rtl" : "ltr"}>
                {backText}
              </p>
            </div>
          )}
        </motion.div>
      </div>

      <div className="h-48 flex flex-col justify-end">
        {isFlipped ? (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button onClick={() => onRate('again')} className="bg-red-50 dark:bg-red-900/20 text-red-600 font-bold p-4 rounded-2xl border-2 border-transparent hover:border-red-200 transition-all">
              Again
              <span className="block text-[10px] font-normal opacity-60">&lt; 1 min</span>
            </button>
            <button onClick={() => onRate('hard')} className="bg-orange-50 dark:bg-orange-900/20 text-orange-600 font-bold p-4 rounded-2xl border-2 border-transparent hover:border-orange-200 transition-all">
              Hard
              <span className="block text-[10px] font-normal opacity-60">2 days</span>
            </button>
            <button onClick={() => onRate('good')} className="bg-green-50 dark:bg-green-900/20 text-green-600 font-bold p-4 rounded-2xl border-2 border-transparent hover:border-green-200 transition-all">
              Good
              <span className="block text-[10px] font-normal opacity-60">4 days</span>
            </button>
            <button onClick={() => onRate('easy')} className="bg-blue-50 dark:bg-blue-900/20 text-blue-600 font-bold p-4 rounded-2xl border-2 border-transparent hover:border-blue-200 transition-all">
              Easy
              <span className="block text-[10px] font-normal opacity-60">7 days</span>
            </button>
          </div>
        ) : (
           <div className="flex flex-col items-center mb-10">
              <p className="text-slate-400 text-xs mb-4">Think of the {frontLang === 'english' ? 'Hebrew' : 'English'} word...</p>
              <Button onClick={() => { speak(card.english); setIsFlipped(true); }} className="w-full py-5 text-lg">
                Reveal Answer
                <ChevronRight className="w-5 h-5" />
              </Button>
           </div>
        )}
      </div>
    </motion.div>
  );
}

function SummaryView({ results, streak, onFinish, onRestart }: any) {
  return (
    <motion.div 
      key="summary"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex-1 flex flex-col p-10 items-center justify-center text-center relative"
    >
      <button 
        onClick={onFinish} 
        className="absolute top-6 left-6 p-2 text-slate-400 hover:text-blue-600 transition-colors"
      >
        <Home className="w-6 h-6" />
      </button>
      <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 text-green-600 rounded-full flex items-center justify-center mb-6">
        <CheckCircle2 className="w-12 h-12" />
      </div>
      <h2 className="text-3xl font-black mb-2">Session Complete!</h2>
      <p className="text-slate-500 mb-10">You've mastered {results.length} words today.</p>
      
      <div className="grid grid-cols-2 gap-4 w-full max-w-sm mb-12">
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
          <p className="text-2xl font-black text-blue-600">{results.length}</p>
          <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Words</p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
          <p className="text-2xl font-black text-orange-500">{streak}</p>
          <p className="text-xs text-slate-500 uppercase font-bold tracking-wider">Day Streak</p>
        </div>
      </div>

      <Button onClick={onFinish} className="w-full max-w-xs py-5 text-lg mb-4">
        Back to Dashboard
      </Button>
      <button onClick={onRestart} className="flex items-center gap-2 text-slate-400 font-bold hover:text-slate-600 transition-colors">
        <RotateCcw className="w-4 h-4" />
        Restart Session
      </button>
    </motion.div>
  );
}

function SmartListView({ listId, words, onHome, onPractice, speak }: any) {
  const now = Date.now();
  const filteredWords = words.filter((w: Word) => {
    if (listId === 'again') return w.level === 0;
    if (listId === 'hard') return w.level === 1;
    if (listId === 'good') return w.level === 2;
    if (listId === 'easy') return w.level >= 3;
    return false;
  });

  const dueWords = filteredWords.filter((w: Word) => !w.nextReview || w.nextReview <= now);

  const titles: any = {
    again: 'Again List',
    hard: 'Hard List',
    good: 'Good List',
    easy: 'Easy List'
  };

  const colors: any = {
    again: 'text-red-600 bg-red-50 dark:bg-red-900/20',
    hard: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20',
    good: 'text-green-600 bg-green-50 dark:bg-green-900/20',
    easy: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20'
  };

  return (
    <motion.div 
      key="smart_list"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="flex-1 flex flex-col p-6 overflow-hidden"
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onHome} className="p-2 -ml-2 text-slate-400 hover:text-slate-600"><ArrowLeft className="w-6 h-6" /></button>
          <h2 className="text-xl font-bold">{titles[listId]}</h2>
        </div>
        <div className={cn("px-3 py-1 rounded-full text-xs font-bold", colors[listId])}>
          {filteredWords.length} words
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-6">
        {dueWords.length > 0 && (
          <Button onClick={onPractice} className="w-full py-4 mb-4 bg-blue-600">
            <Play className="w-4 h-4" />
            Practice {dueWords.length} Due Words
          </Button>
        )}
        
        {filteredWords.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p>No words in this list yet.</p>
          </div>
        ) : (
          filteredWords.map((word: Word) => (
            <div key={word.id} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex items-center justify-between group">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-bold text-slate-800 dark:text-slate-100">{word.english}</p>
                  <button onClick={() => speak(word.english)} className="p-1 text-slate-300 hover:text-blue-500 transition-colors">
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-slate-500 text-sm font-hebrew" dir="rtl">{word.hebrew}</p>
              </div>
              <div className="text-[10px] text-slate-400 font-mono flex flex-col items-end">
                <span>{word.nextReview ? new Date(word.nextReview).toLocaleDateString() : 'New'}</span>
                {word.nextReview && word.nextReview <= now && (
                  <span className="text-red-500 font-bold uppercase text-[8px]">Due Now</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <Button onClick={onHome} className="w-full py-4">
        Back to Dashboard
      </Button>
    </motion.div>
  );
}
