import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  getDocs, 
  where, 
  orderBy, 
  limit, 
  addDoc, 
  serverTimestamp,
  QueryConstraint,
  updateDoc,
  doc,
  writeBatch,
  startAfter
} from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import Papa from 'papaparse';
import { Search, Info, Building2, LogIn, LogOut, ChevronRight, X, Plus, MessageSquarePlus, ClipboardList, Check, FileUp, Trash2 } from 'lucide-react';
import { auth, db, login, logout, handleFirestoreError, OperationType } from './lib/firebase';
import { Category, GlossaryTerm, Language, Suggestion } from './types';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const [user] = useAuthState(auth);
  const [categories, setCategories] = useState<Category[]>([]);
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedLetter, setSelectedLetter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<Language>('en');
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isEditModalOpen, setEditModalOpen] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [isAddCategoryModalOpen, setAddCategoryModalOpen] = useState(false);
  const [isSuggestModalOpen, setSuggestModalOpen] = useState(false);
  const [isSuggestionsViewOpen, setSuggestionsViewOpen] = useState(false);
  const [activeDescriptionId, setActiveDescriptionId] = useState<string | null>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  // Form state for new term
  const [form, setForm] = useState({
    english: '',
    sinhala: '',
    tamil: '',
    categoryId: '',
    description: ''
  });

  const [categoryForm, setCategoryForm] = useState({
    nameEn: '',
    nameSi: '',
    nameTa: ''
  });

  // Form state for suggestion
  const [suggestionForm, setSuggestionForm] = useState({
    english: '',
    sinhala: '',
    tamil: '',
    notes: ''
  });

  const [isAdmin, setIsAdmin] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 640 : false);
  const [isDeduplicating, setIsDeduplicating] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setIsAdmin(user?.email?.toLowerCase() === 'mhmanas@gmail.com');
  }, [user]);

  const handleCsvImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvLoading(true);
    setStatusMessage({ text: 'Fetching existing terms to prevent duplicates...', type: 'success' });

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const data = results.data as Record<string, string>[];
        
        if (data.length === 0) {
          setStatusMessage({ text: 'The CSV file appears to be empty.', type: 'error' });
          setCsvLoading(false);
          return;
        }

        try {
          // Pre-fetch all existing terms to avoid duplicates during this import session
          const existingTermsSnap = await getDocs(query(collection(db, 'terms'), limit(10000)));
          const existingSet = new Set(existingTermsSnap.docs.map(doc => (doc.data() as GlossaryTerm).english.toLowerCase().trim()));
          
          let successCount = 0;
          let errorCount = 0;
          let skipCount = 0;
          let duplicateCount = 0;

          for (const row of data) {
            try {
              // Find keys regardless of case
              const getVal = (possibleKeys: string[]) => {
                const key = Object.keys(row).find(k => possibleKeys.includes(k.trim().toLowerCase()));
                return key ? row[key] : '';
              };

              const englishRaw = getVal(['english', 'english term', 'term', 'en']);
              const english = englishRaw.trim();
              const sinhala = getVal(['sinhala', 'si', 'sinhala term']).trim();
              const tamil = getVal(['tamil', 'ta', 'tamil term']).trim();
              const categoryName = getVal(['category', 'category id', 'type']).trim();
              const description = getVal(['description', 'notes', 'info', 'desc']).trim();

              if (!english) {
                skipCount++;
                continue;
              }

              // Check for duplicates
              if (existingSet.has(english.toLowerCase())) {
                duplicateCount++;
                continue;
              }

              // Find category ID by name
              const category = categories.find(c => 
                c.nameEn.toLowerCase() === categoryName.toLowerCase() || 
                c.nameSi === categoryName || 
                c.nameTa === categoryName
              );

              const termData = {
                english,
                sinhala,
                tamil,
                categoryId: category?.id || 'general',
                description,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
              };

              await addDoc(collection(db, 'terms'), termData);
              existingSet.add(english.toLowerCase()); // Add to set so we don't add it again in same batch
              successCount++;
            } catch (err) {
              console.error('Import row error:', err);
              errorCount++;
            }
          }

          setStatusMessage({ 
            text: `Import complete: ${successCount} added, ${duplicateCount} duplicates skipped, ${skipCount} skipped (missing term), ${errorCount} errors.`, 
            type: successCount > 0 ? 'success' : 'error' 
          });
          setCsvLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          handleSearch(); // Refresh list
        } catch (err) {
          console.error('Import pre-fetch error:', err);
          setStatusMessage({ text: 'Failed to initialize import.', type: 'error' });
          setCsvLoading(false);
        }
      },
      error: (error) => {
        console.error('CSV parse error:', error);
        setStatusMessage({ text: 'Failed to parse CSV file: ' + error.message, type: 'error' });
        setCsvLoading(false);
      }
    });
  };

  const handleDeduplicate = async () => {
    // Avoid window.confirm as it might be blocked in iframes
    setIsDeduplicating(true);
    setStatusMessage({ text: 'Starting database cleanup...', type: 'success' });
    
    try {
      const allTerms: GlossaryTerm[] = [];
      let lastDoc = null;
      let hasMore = true;
      const CHUNK_SIZE = 3000;
      let iterations = 0;
      
      // Limit to 30,000 to prevent infinite loops or excessive memory
      while (hasMore && iterations < 10) {
        iterations++;
        setStatusMessage({ text: `Scanning records... (${allTerms.length} analyzed)`, type: 'success' });
        
        let q;
        if (lastDoc) {
          q = query(collection(db, 'terms'), orderBy('english'), startAfter(lastDoc), limit(CHUNK_SIZE));
        } else {
          q = query(collection(db, 'terms'), orderBy('english'), limit(CHUNK_SIZE));
        }
        
        const snap = await getDocs(q);
        if (snap.empty) {
          hasMore = false;
        } else {
          const chunk = snap.docs.map(doc => {
            const data = doc.data() as Record<string, unknown>;
            return { id: doc.id, ...data } as GlossaryTerm;
          });
          allTerms.push(...chunk);
          lastDoc = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < CHUNK_SIZE) {
            hasMore = false;
          }
        }
      }
      
      const seen = new Map<string, string>(); // lowercase english -> id
      const toDelete: string[] = [];
      
      for (const term of allTerms) {
        if (!term.english) continue;
        const key = term.english.toLowerCase().trim();
        if (seen.has(key)) {
          toDelete.push(term.id);
        } else {
          seen.set(key, term.id);
        }
      }
      
      if (toDelete.length === 0) {
        setStatusMessage({ text: `No duplicates found among ${allTerms.length} records.`, type: 'success' });
      } else {
        setStatusMessage({ text: `Found ${toDelete.length} duplicates. Deleting...`, type: 'success' });
        
        let deletedCount = 0;
        for (let i = 0; i < toDelete.length; i += 500) {
          const batch = writeBatch(db);
          const chunk = toDelete.slice(i, i + 500);
          chunk.forEach(id => {
            batch.delete(doc(db, 'terms', id));
          });
          await batch.commit();
          deletedCount += chunk.length;
          setStatusMessage({ text: `Cleanup progress: ${deletedCount} / ${toDelete.length} removed...`, type: 'success' });
        }
        
        setStatusMessage({ text: `Database clean! Removed ${deletedCount} duplicate entries.`, type: 'success' });
        handleSearch();
      }
    } catch (err) {
      console.error('Deduplication error:', err);
      setStatusMessage({ text: 'Cleanup failed. Try again or check if you have a stable connection.', type: 'error' });
      handleFirestoreError(err, OperationType.DELETE, 'terms');
    } finally {
      setIsDeduplicating(false);
    }
  };

  const handleAiPopulate = async () => {
    if (!form.english) {
      setStatusMessage({ text: 'Please enter an English term first.', type: 'error' });
      return;
    }
    
    setIsAiLoading(true);
    try {
      const response = await fetch('/api/ai/populate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          english: form.english, 
          category: getCategoryName(form.categoryId) 
        }),
      });
      
      if (!response.ok) throw new Error('AI population failed');
      
      const data = await response.json();
      setForm({
        ...form,
        sinhala: data.sinhala,
        tamil: data.tamil,
        description: data.description
      });
      setStatusMessage({ text: 'Fields auto-populated successfully!', type: 'success' });
    } catch (error) {
      console.error(error);
      setStatusMessage({ text: 'AI feature failed. Try manual input.', type: 'error' });
    } finally {
      setIsAiLoading(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const seedData = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const categoriesToAdd = [
        { nameEn: 'Administration', nameSi: 'පරිපාලනය', nameTa: 'நிர்வாகம்' },
        { nameEn: 'Information Technology', nameSi: 'තොරතුරු තාක්ෂණය', nameTa: 'තොරතුරු තාක්ෂණය' },
        { nameEn: 'Legal', nameSi: 'නීතිමය', nameTa: 'சட்டம்' },
        { nameEn: 'Accountancy', nameSi: 'ගිණුම්කරණය', nameTa: 'கணக்கியல்' },
        { nameEn: 'Chemistry', nameSi: 'රසායන විද්යාව', nameTa: 'இரசாயனவியல்' },
        { nameEn: 'Education', nameSi: 'අධ්‍යාපනය', nameTa: 'கல்வி' },
        { nameEn: 'Medicine', nameSi: 'වෛද්‍ය විද්‍යාව', nameTa: 'மருத்துவம்' }
      ];

      for (const cat of categoriesToAdd) {
        const docRef = await addDoc(collection(db, 'categories'), cat);
        const termsToAdd = cat.nameEn === 'Administration' ? [
          { 
            categoryId: docRef.id, 
            english: 'Officer', 
            sinhala: 'නිලධාරියා', 
            tamil: 'அதிகாரி', 
            description: 'A person holding a position of authority in an organization.',
            createdAt: serverTimestamp(), 
            updatedAt: serverTimestamp() 
          },
          { 
            categoryId: docRef.id, 
            english: 'Department', 
            sinhala: 'දෙපාර්තමේන්තුව', 
            tamil: 'திணைக்களம்', 
            description: 'A specialized functional area within an organization.',
            createdAt: serverTimestamp(), 
            updatedAt: serverTimestamp() 
          },
          { 
            categoryId: docRef.id, 
            english: 'Table', 
            sinhala: 'වගුව', 
            tamil: 'அட்டவணை', 
            description: 'A systematic arrangement of data or information in rows and columns.',
            createdAt: serverTimestamp(), 
            updatedAt: serverTimestamp() 
          },
          { 
            categoryId: docRef.id, 
            english: 'Book', 
            sinhala: 'පොත', 
            tamil: 'புத்தகம்', 
            description: 'An official record or register used for administrative documentation.',
            createdAt: serverTimestamp(), 
            updatedAt: serverTimestamp() 
          }
        ] : [
          { categoryId: docRef.id, english: 'Computer', sinhala: 'පරිගණකය', tamil: 'கணினி', createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
          { categoryId: docRef.id, english: 'Network', sinhala: 'ජාලය', tamil: 'வலையமைப்பு', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
        ];

        for (const term of termsToAdd) {
          await addDoc(collection(db, 'terms'), term);
        }
      }
      
      const catSnap = await getDocs(collection(db, 'categories'));
      setCategories(catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
      await handleSearch();

      setStatusMessage({ text: 'Demo data seeded successfully!', type: 'success' });
    } catch (error) {
      console.error(error);
      setStatusMessage({ text: 'Seeding failed. Check console.', type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  // Load initial data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const catSnap = await getDocs(collection(db, 'categories'));
        const cats = catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
        setCategories(cats);

        const termQuery = query(collection(db, 'terms'), orderBy('english'), limit(500));
        const termSnap = await getDocs(termQuery);
        const fetchedTerms = termSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as GlossaryTerm));
        setTerms(fetchedTerms);
        
        // Auto-seed if empty and is admin
        if (cats.length === 0 && fetchedTerms.length === 0 && isAdmin) {
           seedData();
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isAdmin]);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const q = collection(db, 'terms');
      const constraints: QueryConstraint[] = [];

      if (selectedCategory !== 'all') {
        constraints.push(where('categoryId', '==', selectedCategory));
      }
      
      // We always order by English in Firestore to use a consistent index, 
      // but we will sort in memory for the current language.
      const queryConstraints = query(q, ...constraints, orderBy('english'), limit(5000));
      const snap = await getDocs(queryConstraints);
      let results = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as GlossaryTerm));

      // Filter by letter
      if (selectedLetter !== 'all') {
        results = results.filter(term => {
          if (language === 'si') return term.sinhala.startsWith(selectedLetter);
          if (language === 'ta') return term.tamil.startsWith(selectedLetter);
          return term.english.toUpperCase().startsWith(selectedLetter);
        });
      }

      // Search by query
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        results = results.filter(term => 
          term.english.toLowerCase().includes(lowerQuery) ||
          term.sinhala.includes(searchQuery) ||
          term.tamil.includes(searchQuery) ||
          term.description?.toLowerCase().includes(lowerQuery)
        );
      }

      // Sort results based on current language
      results.sort((a, b) => {
        if (language === 'si') return a.sinhala.localeCompare(b.sinhala, 'si');
        if (language === 'ta') return a.tamil.localeCompare(b.tamil, 'ta');
        return a.english.localeCompare(b.english);
      });

      setTerms(results);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'terms');
    } finally {
      setLoading(false);
    }
  };

  const alphabet = language === 'si' 
    ? ["අ", "ආ", "ඇ", "ඉ", "උ", "එ", "ඔ", "ක", "ග", "ච", "ජ", "ට", "ඩ", "ත", "ද", "න", "ප", "බ", "ම", "ය", "ර", "ල", "ව", "ස", "හ"]
    : language === 'ta'
    ? ["அ", "ஆ", "இ", "ஈ", "உ", "ஊ", "எ", "ஏ", "ஐ", "ஒ", "ஓ", "ஔ", "க", "ச", "ட", "த", "ந", "ப", "ம", "ய", "ர", "ல", "வ"]
    : "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  const fetchSuggestions = async () => {
    if (!isAdmin) return;
    try {
      const q = query(collection(db, 'suggestions'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setSuggestions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Suggestion)));
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'suggestions');
    }
  };

  useEffect(() => {
    if (isSuggestionsViewOpen) {
      fetchSuggestions();
    }
  }, [isSuggestionsViewOpen]);

  useEffect(() => {
    handleSearch();
  }, [selectedLetter, selectedCategory]);

  useEffect(() => {
    setSelectedLetter('all');
    setSearchQuery('');
    handleSearch();
  }, [language]);

  const getCategoryName = (id: string) => {
    const cat = categories.find(c => c.id === id);
    if (!cat) return '-';
    return language === 'si' ? cat.nameSi : language === 'ta' ? cat.nameTa : cat.nameEn;
  };

  const handleLogin = async () => {
    try {
      await login();
      setStatusMessage({ text: 'Successfully logged in!', type: 'success' });
    } catch (error: unknown) {
      console.error('Login error:', error);
      let message = 'Login failed. Please check if popups are blocked.';
      
      if (error && typeof error === 'object' && 'code' in error) {
        const authError = error as { code: string; message?: string };
        if (authError.code === 'auth/popup-closed-by-user') {
          message = 'Login popup was closed before completion.';
        } else if (authError.code === 'auth/unauthorized-domain') {
          message = 'This domain is not authorized in Firebase Console. Please add ' + window.location.hostname + ' to Authorized Domains.';
        } else if (authError.message) {
          message = authError.message;
        }
      }
      setStatusMessage({ text: message, type: 'error' });
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setStatusMessage({ text: 'Logged out.', type: 'success' });
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleAddTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setLoading(true);
    try {
      const { description, ...rest } = form;
      const termData = {
        ...rest,
        ...(description ? { description } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      if (editingTermId) {
        await updateDoc(doc(db, 'terms', editingTermId), {
          ...rest,
          ...(description ? { description } : { description: '' }),
          updatedAt: serverTimestamp()
        });
        setStatusMessage({ text: 'Term updated successfully!', type: 'success' });
      } else {
        await addDoc(collection(db, 'terms'), termData);
        setStatusMessage({ text: 'Term added successfully!', type: 'success' });
      }
      
      setAddModalOpen(false);
      setEditModalOpen(false);
      setEditingTermId(null);
      setForm({ english: '', sinhala: '', tamil: '', categoryId: '', description: '' });
      handleSearch(); // Refresh results
    } catch (error) {
      console.error('Term operation error:', error);
      setStatusMessage({ text: `Failed to ${editingTermId ? 'update' : 'add'} term.`, type: 'error' });
      handleFirestoreError(error, editingTermId ? OperationType.UPDATE : OperationType.CREATE, 'terms');
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const openEditModal = (term: GlossaryTerm) => {
    setEditingTermId(term.id || null);
    setForm({
      english: term.english,
      sinhala: term.sinhala,
      tamil: term.tamil,
      categoryId: term.categoryId,
      description: term.description || ''
    });
    setEditModalOpen(true);
  };

  const openSuggestEditModal = (term: GlossaryTerm) => {
    setSuggestionForm({
      english: term.english,
      sinhala: term.sinhala,
      tamil: term.tamil,
      notes: `Suggested edit for term: ${term.english}`
    });
    setSuggestModalOpen(true);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'categories'), categoryForm);
      setStatusMessage({ text: 'Category added successfully!', type: 'success' });
      setAddCategoryModalOpen(false);
      setCategoryForm({ nameEn: '', nameSi: '', nameTa: '' });
      
      // Refresh categories
      const catSnap = await getDocs(collection(db, 'categories'));
      setCategories(catSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    } catch (error) {
      console.error('Add category error:', error);
      setStatusMessage({ text: 'Failed to add category.', type: 'error' });
      handleFirestoreError(error, OperationType.CREATE, 'categories');
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const handleSuggestTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const suggestionData = {
        ...suggestionForm,
        userId: user.uid,
        userEmail: user.email || '',
        status: 'pending',
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'suggestions'), suggestionData);
      setStatusMessage({ text: 'Suggestion submitted! Thank you for your contribution.', type: 'success' });
      setSuggestModalOpen(false);
      setSuggestionForm({ english: '', sinhala: '', tamil: '', notes: '' });
    } catch (error) {
      console.error('Suggest term error details:', error);
      setStatusMessage({ text: 'Failed to submit suggestion.', type: 'error' });
      handleFirestoreError(error, OperationType.CREATE, 'suggestions');
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const [suggestionCategories, setSuggestionCategories] = useState<Record<string, string>>({});

  const handleUpdateSuggestionStatus = async (sug: Suggestion, status: 'approved' | 'rejected') => {
    if (!isAdmin || !sug.id) return;
    
    const categoryId = suggestionCategories[sug.id];
    if (status === 'approved' && !categoryId) {
      setStatusMessage({ text: 'Please select a category before approving.', type: 'error' });
      return;
    }

    setLoading(true);
    try {
      if (status === 'approved') {
        const termData = {
          english: sug.english,
          sinhala: sug.sinhala,
          tamil: sug.tamil,
          categoryId: categoryId,
          description: sug.notes || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };
        await addDoc(collection(db, 'terms'), termData);
      }

      await updateDoc(doc(db, 'suggestions', sug.id), { status });
      setStatusMessage({ text: `Suggestion ${status} and added to glossary!`, type: 'success' });
      fetchSuggestions();
      handleSearch(); // Refresh glossary results
    } catch (error) {
      console.error('Update suggestion error:', error);
      setStatusMessage({ text: 'Failed to update suggestion status.', type: 'error' });
      handleFirestoreError(error, OperationType.UPDATE, 'suggestions');
    } finally {
      setLoading(false);
      setTimeout(() => setStatusMessage(null), 5000);
    }
  };

  const t = {
    en: {
      title: 'English-Sinhala-Tamil Glossary',
      subtitle: 'TRANSLATION.LK',
      search: 'Search Terms',
      category: 'Select Category',
      allCategories: 'All Categories',
      categoryLabel: 'Category',
      results: 'Results',
      english: 'English',
      sinhala: 'Sinhala',
      tamil: 'Tamil',
      info: 'Info',
      loading: 'Loading glossary data...',
      noResults: 'No terms found.',
      login: 'Admin Access',
      logout: 'Log Out',
    },
    si: {
      title: 'ඉංග්‍රීසි-සිංහල-දෙමළ පාරිභාෂික ශබ්දමාලාව',
      subtitle: 'TRANSLATION.LK',
      search: 'පද සොයන්න',
      category: 'ප්‍රභේදය තෝරන්න',
      allCategories: 'සියලුම ප‍්‍රභේද',
      categoryLabel: 'ප්‍රභේදය',
      results: 'ප්‍රතිඵල',
      english: 'ඉංග්‍රීසි',
      sinhala: 'සිංහල',
      tamil: 'දෙමළ',
      info: 'තොරතුරු',
      loading: 'දත්ත පූරණය වෙමින් පවතී...',
      noResults: 'කිසිදු පදයක් හමු නොවීය.',
      login: 'ඇතුල් වන්න',
      logout: 'පිටවන්න',
    },
    ta: {
      title: 'ஆங்கில-சிங்கள-தமிழ் கலைச்சொற்றொகுதி',
      subtitle: 'TRANSLATION.LK',
      search: 'சொற்களைத் தேடுக',
      category: 'வகையைத் தேர்ந்தெடுக்கவும்',
      allCategories: 'அனைத்து வகைகள்',
      categoryLabel: 'வகை',
      results: 'முடிவுகள்',
      english: 'ஆங்கிலம்',
      sinhala: 'சிங்களம்',
      tamil: 'தமிழ்',
      info: 'தகவல்',
      loading: 'தரவு ஏற்றப்படுகிறது...',
      noResults: 'எந்த சொற்களும் காணப்படவில்லை.',
      login: 'உள்நுழைய',
      logout: 'வெளியேறு',
    }
  }[language];

  return (
    <div className="min-h-screen w-full bg-slate-50 flex flex-col font-sans overflow-x-hidden">
      {/* Top Bar / Header */}
      <header className="bg-gov-blue text-white shadow-xl py-2.5 md:py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto w-full px-4 md:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 md:gap-4 min-w-0 flex-1">
            <div className="p-1 md:p-2 bg-gov-gold rounded-lg md:rounded-xl shadow-inner shrink-0 scale-90 md:scale-100">
              <Building2 className="w-4 h-4 md:w-8 md:h-8 text-gov-blue" />
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <h1 className="text-xs sm:text-lg md:text-2xl font-bold tracking-tight truncate max-w-[150px] xs:max-w-[250px] sm:max-w-[500px] md:max-w-none">{t.title}</h1>
              <p className="text-gov-gold text-[8px] md:text-sm font-medium opacity-90 truncate max-w-[130px] xs:max-w-[200px] sm:max-w-[300px] md:max-w-none leading-tight">{t.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
            <div className="hidden sm:flex bg-white/10 rounded-full p-0.5">
              {(['en', 'si', 'ta'] as Language[]).map(lang => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={cn(
                    "px-2 py-0.5 text-xs font-semibold uppercase transition-colors rounded-full",
                    language === lang ? "bg-gov-gold text-gov-blue" : "hover:text-gov-gold"
                  )}
                >
                  {lang}
                </button>
              ))}
            </div>

            {user ? (
              <button 
                onClick={handleLogout}
                className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-1 md:px-3 rounded-lg text-[9px] md:text-sm transition-all whitespace-nowrap"
              >
                <LogOut className="w-3 h-3 md:w-4 md:h-4" />
                <span className="hidden sm:inline font-bold">Logout</span>
                <span className="sm:hidden font-bold">Out</span>
              </button>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-1 bg-gov-gold text-gov-blue hover:bg-yellow-400 px-1.5 sm:px-4 py-1 sm:py-2 rounded-lg text-[9px] sm:text-sm font-bold transition-all"
              >
                <LogIn className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Login</span>
                <span className="sm:hidden">Login</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {user && !isAdmin && (
        <div className="bg-yellow-50 border-b border-yellow-200 p-2 text-center text-xs text-yellow-800">
          Logged in as {user.email}. Not an admin.
        </div>
      )}

      <main className="flex-grow w-full px-4 sm:px-6 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
        {/* Status Message */}
        <AnimatePresence>
          {statusMessage && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                "p-2.5 rounded-lg mb-4 flex items-center gap-2 shadow-md font-semibold border",
                statusMessage.type === 'success' ? "bg-green-600 text-white border-green-500" : "bg-red-600 text-white border-red-500"
              )}
            >
              {statusMessage.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <X className="w-4 h-4 shrink-0" />}
              <p className="flex-grow text-[11px] md:text-sm">{statusMessage.text}</p>
              <button onClick={() => setStatusMessage(null)} className="p-0.5 hover:bg-white/10 rounded">
                <X className="w-3.5 h-3.5 md:w-4 md:h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Suggestion Section for Visitors */}
        <div className="mb-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gov-gold/10 border border-gov-gold/30 p-4 sm:p-6 rounded-2xl">
          <div className="text-center sm:text-left">
            <h3 className="text-gov-blue font-bold text-sm md:text-lg tracking-tight">Contributing to the Glossary</h3>
            <p className="text-slate-600 text-xs md:text-sm">Know a missing term? Help improve our record.</p>
          </div>
          {user ? (
            <button 
              onClick={() => setSuggestModalOpen(true)}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gov-blue text-white hover:bg-blue-900 px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold transition-all shadow-lg text-xs md:text-sm"
            >
              <MessageSquarePlus className="w-4 h-4 md:w-5 md:h-5" />
              Suggest a Term
            </button>
          ) : (
            <button 
              onClick={handleLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-gov-blue text-white hover:bg-blue-900 px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold transition-all shadow-lg text-xs md:text-sm"
            >
              <LogIn className="w-4 h-4 md:w-5 md:h-5" />
              Sign in to Suggest
            </button>
          )}
        </div>

        {/* Admin Suggestions View Toggle */}
        {isAdmin && (
          <div className="mb-8">
              <button 
                onClick={() => setSuggestionsViewOpen(!isSuggestionsViewOpen)}
                className={cn(
                  "flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold transition-all shadow-md text-sm sm:text-base",
                  isSuggestionsViewOpen ? "bg-slate-800 text-white" : "bg-white text-slate-800 border border-slate-200"
                )}
              >
                <ClipboardList className="w-4 h-4 sm:w-5 sm:h-5 text-gov-gold" />
                {isSuggestionsViewOpen ? (isMobile ? "Glossary" : "Back to Glossary") : "View Visitor Suggestions"}
              </button>
          </div>
        )}

        {isAdmin && isSuggestionsViewOpen ? (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Pending Suggestions</h2>
              </div>
              <div className="text-sm font-medium text-slate-500">{suggestions.length} entries found</div>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              {suggestions.length > 0 ? (
                suggestions.map(sug => (
                  <motion.div 
                    key={sug.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex flex-col md:flex-row justify-between gap-6">
                      <div className="flex-grow space-y-4">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "px-3 py-1 rounded-full text-xs font-bold uppercase",
                            sug.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                            sug.status === 'approved' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          )}>
                            {sug.status}
                          </div>
                          <span className="text-slate-400 text-xs font-medium">by {sug.userEmail}</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <span className="text-xs uppercase font-bold text-slate-400 block mb-1">English</span>
                            <p className="font-bold text-slate-800">{sug.english}</p>
                          </div>
                          <div>
                            <span className="text-xs uppercase font-bold text-slate-400 block mb-1">Sinhala</span>
                            <p className="text-base font-medium text-slate-700">{sug.sinhala}</p>
                          </div>
                          <div>
                            <span className="text-xs uppercase font-bold text-slate-400 block mb-1">Tamil</span>
                            <p className="text-base font-medium text-slate-700">{sug.tamil}</p>
                          </div>
                        </div>
                        {sug.notes && (
                          <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-600 italic">
                            "{sug.notes}"
                          </div>
                        )}
                        
                        {sug.status === 'pending' && (
                          <div className="pt-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Assign Category for Glossary</label>
                            <select 
                              value={suggestionCategories[sug.id || ''] || ''}
                              onChange={(e) => setSuggestionCategories(prev => ({ ...prev, [sug.id || '']: e.target.value }))}
                              className="w-full max-w-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-gov-blue"
                            >
                              <option value="">Select Category...</option>
                              {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      
                      {sug.status === 'pending' && (
                        <div className="flex flex-row md:flex-col gap-2 shrink-0">
                          <button 
                            disabled={!suggestionCategories[sug.id || '']}
                            onClick={() => sug.id && handleUpdateSuggestionStatus(sug, 'approved')}
                            className={cn(
                              "p-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 md:w-full",
                              suggestionCategories[sug.id || ''] 
                                ? "bg-green-600 hover:bg-green-700 text-white" 
                                : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                            )}
                          >
                            <Check className="w-5 h-5" />
                            <span className="md:hidden lg:inline">Approve</span>
                          </button>
                          <button 
                            onClick={() => sug.id && handleUpdateSuggestionStatus(sug, 'rejected')}
                            className="bg-red-600 hover:bg-red-700 text-white p-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 md:w-full"
                          >
                            <X className="w-5 h-5" />
                            <span className="md:hidden lg:inline">Reject</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="bg-white p-12 text-center text-slate-400 rounded-2xl border border-dashed border-slate-300">
                  No suggestions available yet.
                </div>
              )}
            </div>
          </section>
        ) : (
          <>
        {/* Search Panel */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-5">
              <label className="block text-sm font-semibold text-slate-600 mb-2">{t.search}</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue focus:border-gov-blue outline-none transition-all text-sm md:text-base"
                  placeholder={language === 'si' ? 'උදා: පරිපාලනය' : language === 'ta' ? 'உதா: நிர்வாகம்' : 'e.g. Administration'}
                />
              </div>
            </div>
            
            <div className="md:col-span-4">
              <label className="block text-sm font-semibold text-slate-600 mb-2">{t.category}</label>
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue focus:border-gov-blue outline-none appearance-none cursor-pointer text-sm md:text-base"
              >
                <option value="all">{t.allCategories}</option>
                {categories.length > 0 ? (
                  categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {language === 'si' ? cat.nameSi : language === 'ta' ? cat.nameTa : cat.nameEn}
                    </option>
                  ))
                ) : (
                  <option disabled>No categories available</option>
                )}
              </select>
            </div>

            <div className="md:col-span-3">
              <button 
                onClick={handleSearch}
                disabled={loading}
                className="w-full bg-gov-blue hover:bg-blue-900 text-white font-bold py-3 px-6 rounded-xl shadow-lg hover:shadow-gov-blue/20 transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    <span>{language === 'si' ? 'සොයන්න' : language === 'ta' ? 'தேடுக' : 'Search'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Alphabet Filter */}
        <div className="flex flex-wrap gap-1 mb-4 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm justify-start">
          <button
            onClick={() => setSelectedLetter('all')}
            className={cn(
              "px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all",
              selectedLetter === 'all' ? "bg-gov-blue text-white" : "hover:bg-slate-100 text-slate-600"
            )}
          >
            ALL
          </button>
          {alphabet.map(letter => (
            <button
              key={letter}
              onClick={() => setSelectedLetter(letter)}
              className={cn(
                "w-7 h-8 flex items-center justify-center text-xs font-bold rounded-lg transition-all",
                selectedLetter === letter ? "bg-gov-blue text-white" : "hover:bg-slate-100 text-slate-600"
              )}
            >
              {letter}
            </button>
          ))}
        </div>

        {/* Results Info */}
        <div className="flex flex-wrap justify-between items-center gap-2 mb-4 px-1">
          <h2 className="text-base md:text-lg font-bold text-slate-800 flex items-center gap-2">
            <ChevronRight className="text-gov-gold w-4 h-4" />
            {t.results} ({terms.length})
          </h2>
            {isAdmin && (
               <div className="flex flex-wrap gap-2 sm:gap-4">
                {categories.length === 0 && !loading && (
                   <button 
                    onClick={seedData}
                    className="flex items-center gap-2 bg-gov-red text-white hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold transition-all animate-pulse"
                  >
                    <Plus className="w-4 h-4" />
                    Seed Initial Data
                  </button>
                 )}
                 {categories.length > 0 && isAdmin && (
                   <div className="flex gap-4">
                    <button 
                      onClick={() => setAddCategoryModalOpen(true)}
                      className="flex items-center gap-2 text-gov-blue hover:underline font-semibold text-sm"
                     >
                      <Plus className="w-4 h-4" />
                      Add Category
                     </button>
                     <button 
                      onClick={() => setAddModalOpen(true)}
                      className="flex items-center gap-2 text-gov-blue hover:underline font-semibold text-sm"
                     >
                      <Plus className="w-4 h-4" />
                      Add New Term
                     </button>
                     <button 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={csvLoading}
                      className="flex items-center gap-2 text-gov-blue hover:underline font-semibold text-sm"
                     >
                      {csvLoading ? (
                        <div className="w-4 h-4 border-2 border-gov-blue/20 border-t-gov-blue rounded-full animate-spin" />
                      ) : (
                        <FileUp className="w-4 h-4" />
                      )}
                      Import CSV
                     </button>
                     <button 
                      onClick={handleDeduplicate}
                      disabled={isDeduplicating}
                      className="flex items-center gap-2 text-red-600 hover:underline font-semibold text-sm"
                     >
                      {isDeduplicating ? (
                        <div className="w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      Clean Duplicates
                     </button>
                     <input 
                       type="file" 
                       ref={fileInputRef} 
                       onChange={handleCsvImport} 
                       accept=".csv" 
                       className="hidden" 
                     />
                   </div>
                 )}
               </div>
            )}
            {!user && categories.length === 0 && !loading && (
              <div className="text-xs text-slate-400 italic">
                System initialized. Admin login required to seed initial glossary data.
              </div>
            )}
        </div>

        {/* Results Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse min-w-[500px] md:min-w-0">
              <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 md:px-4 py-3 text-[10px] font-bold uppercase text-slate-500 tracking-wider">#</th>
                <th className="px-2 md:px-4 py-3 text-xs md:text-sm font-bold text-gov-blue uppercase tracking-wider">{t.english}</th>
                <th className="px-2 md:px-4 py-3 text-xs md:text-sm font-bold text-gov-blue uppercase tracking-wider">{t.categoryLabel}</th>
                <th className="px-2 md:px-4 py-3 text-xs md:text-sm font-bold text-gov-blue uppercase tracking-wider">{t.sinhala}</th>
                <th className="px-2 md:px-4 py-3 text-xs md:text-sm font-bold text-gov-blue uppercase tracking-wider">{t.tamil}</th>
                <th className="px-2 md:px-4 py-3 text-[10px] font-bold uppercase text-slate-500 tracking-wider font-mono">{t.info}</th>
                <th className="px-2 md:px-4 py-3 text-[10px] font-bold uppercase text-slate-500 tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && terms.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 md:px-4 py-16 text-center text-slate-400 font-medium">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-gov-blue/10 border-t-gov-blue rounded-full animate-spin" />
                      {t.loading}
                    </div>
                  </td>
                </tr>
              ) : terms.length > 0 ? (
                terms.map((term, idx) => (
                  <motion.tr 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx, 25) * 0.015 }}
                    key={term.id} 
                    className="hover:bg-slate-50 transition-colors group"
                  >
                    <td className="px-2 md:px-4 py-3 text-xs text-slate-400 font-mono">{idx + 1}</td>
                    <td className="px-2 md:px-4 py-3 text-xs md:text-sm font-semibold text-slate-800">{term.english}</td>
                    <td className="px-2 md:px-4 py-3">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] md:text-xs font-medium bg-blue-100 text-blue-800">
                        {getCategoryName(term.categoryId)}
                      </span>
                    </td>
                    <td className="px-2 md:px-4 py-3 text-xs md:text-sm font-medium text-slate-700">
                      <div>{term.sinhala}</div>
                      <AnimatePresence>
                        {activeDescriptionId === term.id && term.description && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="text-[9px] md:text-xs font-normal text-slate-500 mt-1 bg-slate-100 p-1.5 rounded-md border-l-4 border-gov-blue"
                          >
                            <strong>Notes:</strong> {term.description}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </td>
                    <td className="px-2 md:px-4 py-3 text-xs md:text-sm font-medium text-slate-700">{term.tamil}</td>
                    <td className="px-2 md:px-4 py-3">
                      <div className="flex gap-1">
                        {term.description ? (
                          <button 
                            onClick={() => setActiveDescriptionId(activeDescriptionId === term.id ? null : term.id)}
                            className={cn(
                              "p-1.5 rounded-lg transition-all",
                              activeDescriptionId === term.id ? "bg-gov-blue text-white" : "text-slate-400 hover:text-gov-blue hover:bg-blue-50"
                            )}
                          >
                            <Info className="w-3.5 h-3.5 md:w-4 md:h-4" />
                          </button>
                        ) : '-'}
                      </div>
                    </td>
                    <td className="px-2 md:px-4 py-3">
                      {isAdmin ? (
                        <button 
                          onClick={() => openEditModal(term)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-gov-blue hover:text-white text-slate-600 rounded-md text-[10px] font-bold transition-all"
                        >
                          EDIT
                        </button>
                      ) : (
                        <button 
                          onClick={() => openSuggestEditModal(term)}
                          className="px-2.5 py-1 bg-gov-gold/20 hover:bg-gov-gold text-gov-blue rounded-md text-[10px] font-bold transition-all"
                        >
                          SUGGEST
                        </button>
                      )}
                    </td>
                  </motion.tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-2 md:px-4 py-16 text-center text-slate-400 italic">
                    {t.noResults}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-800 text-slate-400 py-8 px-3 sm:px-8 md:px-12 mt-12 border-t border-slate-700">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-slate-700 rounded text-gov-gold">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="text-white font-bold">{t.title}</h3>
            </div>
            <p className="text-sm leading-relaxed">
              Serving citizens by providing accurate translations for professional and educational use.
            </p>
          </div>
          
          <div>
            <h4 className="text-white font-bold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-gov-gold transition-colors">Glossary Policy</a></li>
              <li><a href="#" className="hover:text-gov-gold transition-colors">Publications</a></li>
              <li><a href="#" className="hover:text-gov-gold transition-colors">Contact Information</a></li>
              <li><a href="#" className="hover:text-gov-gold transition-colors">Downloads</a></li>
            </ul>
          </div>

          <div>
             <h4 className="text-white font-bold mb-4">Multilingual Support</h4>
             <p className="text-sm mb-4">Supported languages across the platform:</p>
             <div className="flex gap-2">
               <span className="px-3 py-1 bg-slate-700 rounded-full text-xs font-bold text-slate-200">SINHALA</span>
               <span className="px-3 py-1 bg-slate-700 rounded-full text-xs font-bold text-slate-200">TAMIL</span>
               <span className="px-3 py-1 bg-slate-700 rounded-full text-xs font-bold text-slate-200">ENGLISH</span>
             </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto pt-12 mt-12 border-t border-slate-700 text-center text-xs">
          © {new Date().getFullYear()} TRANSLATION.LK. All Rights Reserved.
        </div>
      </footer>

      {/* Add Category Modal */}
      <AnimatePresence>
        {isAddCategoryModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAddCategoryModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="bg-gov-blue p-6 text-white flex justify-between items-center">
                <h3 className="text-xl font-bold">Add New Category</h3>
                <button onClick={() => setAddCategoryModalOpen(false)} className="hover:bg-white/10 p-2 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAddCategory} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Category Name (English) *</label>
                    <input 
                      required
                      value={categoryForm.nameEn}
                      onChange={e => setCategoryForm({...categoryForm, nameEn: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Category Name (Sinhala) *</label>
                    <input 
                      required
                      value={categoryForm.nameSi}
                      onChange={e => setCategoryForm({...categoryForm, nameSi: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Category Name (Tamil) *</label>
                    <input 
                      required
                      value={categoryForm.nameTa}
                      onChange={e => setCategoryForm({...categoryForm, nameTa: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setAddCategoryModalOpen(false)}
                    className="px-6 py-3 font-bold text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    disabled={loading}
                    type="submit"
                    className="px-8 py-3 bg-gov-blue hover:bg-blue-900 text-white font-bold rounded-xl shadow-lg transition-all flex items-center gap-2"
                  >
                    {loading && <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                    Save Category
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add/Edit Term Modal */}
      <AnimatePresence>
        {(isAddModalOpen || isEditModalOpen) && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setAddModalOpen(false);
                setEditModalOpen(false);
                setEditingTermId(null);
                setForm({ english: '', sinhala: '', tamil: '', categoryId: '', description: '' });
              }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="bg-gov-blue p-6 text-white flex justify-between items-center">
                <h3 className="text-xl font-bold">{editingTermId ? 'Update Glossary Term' : 'Add New Glossary Term'}</h3>
                <button 
                  onClick={() => {
                    setAddModalOpen(false);
                    setEditModalOpen(false);
                    setEditingTermId(null);
                    setForm({ english: '', sinhala: '', tamil: '', categoryId: '', description: '' });
                  }} 
                  className="hover:bg-white/10 p-2 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAddTerm} className="p-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-bold text-slate-700">English Term *</label>
                      <button 
                        type="button"
                        onClick={handleAiPopulate}
                        disabled={isAiLoading || !form.english}
                        className="text-xs font-bold text-gov-blue hover:text-blue-800 disabled:opacity-50 flex items-center gap-1 transition-all"
                      >
                        {isAiLoading ? (
                          <div className="w-3 h-3 border-2 border-gov-blue/20 border-t-gov-blue rounded-full animate-spin" />
                        ) : (
                          <MessageSquarePlus className="w-3 h-3" />
                        )}
                        AI Auto-populate
                      </button>
                    </div>
                    <input 
                      required
                      value={form.english}
                      onChange={e => setForm({...form, english: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Category *</label>
                    <select 
                      required
                      value={form.categoryId}
                      onChange={e => setForm({...form, categoryId: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    >
                      <option value="">Select Category</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.nameEn}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Sinhala Meaning *</label>
                    <input 
                      required
                      value={form.sinhala}
                      onChange={e => setForm({...form, sinhala: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Tamil Meaning *</label>
                    <input 
                      required
                      value={form.tamil}
                      onChange={e => setForm({...form, tamil: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Description (Optional)</label>
                  <textarea 
                    value={form.description}
                    onChange={e => setForm({...form, description: e.target.value})}
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-blue outline-none resize-none"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => {
                      setAddModalOpen(false);
                      setEditModalOpen(false);
                      setEditingTermId(null);
                      setForm({ english: '', sinhala: '', tamil: '', categoryId: '', description: '' });
                    }}
                    className="px-6 py-3 font-bold text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    disabled={loading}
                    type="submit"
                    className="px-8 py-3 bg-gov-blue hover:bg-blue-900 text-white font-bold rounded-xl shadow-lg transition-all flex items-center gap-2"
                  >
                    {loading && <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                    {editingTermId ? 'Update Term' : 'Save Term'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Suggest Term Modal */}
      <AnimatePresence>
        {isSuggestModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSuggestModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="bg-gov-gold p-6 text-gov-blue flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <MessageSquarePlus className="w-6 h-6" />
                  <h3 className="text-xl font-bold">Suggest a New Term</h3>
                </div>
                <button onClick={() => setSuggestModalOpen(false)} className="hover:bg-black/5 p-2 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSuggestTerm} className="p-8 space-y-6">
                <p className="text-sm text-slate-500 italic">
                  Thank you for helping us expand the glossary. Your suggestion will be reviewed by our team.
                </p>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">English Term *</label>
                    <input 
                      required
                      value={suggestionForm.english}
                      onChange={e => setSuggestionForm({...suggestionForm, english: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-gold outline-none md:text-lg"
                      placeholder="e.g. Artificial Intelligence"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Sinhala Meaning *</label>
                      <input 
                        required
                        value={suggestionForm.sinhala}
                        onChange={e => setSuggestionForm({...suggestionForm, sinhala: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-gold outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700">Tamil Meaning *</label>
                      <input 
                        required
                        value={suggestionForm.tamil}
                        onChange={e => setSuggestionForm({...suggestionForm, tamil: e.target.value})}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-gold outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Notes / Context (Optional)</label>
                    <textarea 
                      value={suggestionForm.notes}
                      onChange={e => setSuggestionForm({...suggestionForm, notes: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-gov-gold outline-none resize-none"
                      placeholder="Explain how this term is used or where it appeared..."
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <button 
                    type="button"
                    onClick={() => setSuggestModalOpen(false)}
                    className="px-4 py-2 sm:px-6 sm:py-3 font-bold text-slate-500 hover:text-slate-700 transition-all text-sm"
                  >
                    Discard
                  </button>
                  <button 
                    disabled={loading}
                    type="submit"
                    className="px-6 py-2 sm:px-8 sm:py-3 bg-gov-blue hover:bg-blue-900 text-white font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 text-sm"
                  >
                    {loading && <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                    Submit Suggestion
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
