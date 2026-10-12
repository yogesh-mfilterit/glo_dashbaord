import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

interface LoadingContextType {
  isGlobalLoading: boolean;
  setIsGlobalLoading: (loading: boolean) => void;
  showSummaryLoading: () => void;
  hideSummaryLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Utility function to safely remove DOM elements
  const safeRemoveElement = (elementId: string) => {
    try {
      const element = document.getElementById(elementId);
      if (element && element.parentNode) {
        element.remove();
      }
    } catch (error) {
      console.warn(`Error removing element ${elementId}:`, error);
    }
  };

  // Set mounted state
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Add CSS styles for loading states
  useEffect(() => {
    const styleId = 'loading-provider-styles';
    
    // Check if styles already exist
    let style = document.getElementById(styleId) as HTMLStyleElement;
    
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        body.is-loading {
          pointer-events: none;
          user-select: none;
        }
        
        body.is-loading * {
          cursor: wait !important;
        }
        
        .loading-summary {
          overflow: hidden;
        }
        
        #global-loading-overlay {
          animation: fadeIn 0.2s ease-in-out;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    return () => {
      // Only remove styles if this is the last instance
      try {
        if (style && style.parentNode) {
          style.remove();
        }
      } catch (error) {
        console.warn('Error removing loading styles:', error);
      }
    };
  }, []);

  const showSummaryLoading = () => {
    setIsGlobalLoading(true);
    // Also add a class to body for immediate visual feedback
    try {
      document.body.classList.add('loading-summary');
      // Change cursor immediately
      document.body.style.cursor = 'wait';
      // Add loading class to body
      document.body.classList.add('is-loading');
    } catch (error) {
      console.warn('Error setting body classes:', error);
    }
  };

  const hideSummaryLoading = () => {
    // Add a small delay to prevent race conditions
    setTimeout(() => {
      if (isMounted) {
        setIsGlobalLoading(false);
        try {
          document.body.classList.remove('loading-summary');
          // Reset cursor
          document.body.style.cursor = 'default';
          // Remove loading class
          document.body.classList.remove('is-loading');
        } catch (error) {
          console.warn('Error removing body classes:', error);
        }
      }
    }, 100); // 100ms delay
  };

  // Add global loading overlay
  useEffect(() => {
    if (isGlobalLoading) {
      // Create and show global loading overlay
      const overlay = document.createElement('div');
      overlay.id = 'global-loading-overlay';
      overlay.className = 'fixed inset-0 z-[9999] bg-blue-600/90 backdrop-blur-sm flex items-center justify-center';
      overlay.innerHTML = `
        <div class="text-center text-white">
          <div class="animate-spin rounded-full h-16 w-16 border-b-2 border-white mx-auto mb-4"></div>
          <h2 class="text-2xl font-bold mb-2">Loading Summary Dashboard</h2>
          <p class="text-blue-100">Please wait while we prepare your data...</p>
          <div class="mt-4 w-64 bg-blue-700 rounded-full h-2">
            <div class="bg-white h-2 rounded-full animate-pulse" style="width: 60%"></div>
          </div>
        </div>
      `;
      
      // Check if overlay already exists and remove it first
      safeRemoveElement('global-loading-overlay');
      
      document.body.appendChild(overlay);
    } else {
      // Remove global loading overlay safely
      safeRemoveElement('global-loading-overlay');
    }

    return () => {
      // Cleanup function - safely remove overlay if it exists
      safeRemoveElement('global-loading-overlay');
    };
  }, [isGlobalLoading]);

  // Cleanup effect when component unmounts
  useEffect(() => {
    return () => {
      // Clean up all loading-related DOM elements and classes
      safeRemoveElement('global-loading-overlay');
      try {
        document.body.classList.remove('loading-summary', 'is-loading');
        document.body.style.cursor = 'default';
      } catch (error) {
        console.warn('Error cleaning up body classes:', error);
      }
    };
  }, []);

  return (
    <LoadingContext.Provider value={{
      isGlobalLoading,
      setIsGlobalLoading,
      showSummaryLoading,
      hideSummaryLoading
    }}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
}
