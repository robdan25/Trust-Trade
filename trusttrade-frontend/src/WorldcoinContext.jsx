import { createContext, useState, useCallback } from 'react'

export const WorldcoinContext = createContext()

export function WorldcoinProvider({ children }) {
  const [worldcoinUser, setWorldcoinUser] = useState(null)
  const [worldcoinVerified, setWorldcoinVerified] = useState(false)
  const [verificationError, setVerificationError] = useState(null)
  const [isVerifying, setIsVerifying] = useState(false)

  const handleVerificationSuccess = useCallback((data) => {
    console.log('Worldcoin verification successful:', data)

    // Extract the necessary data
    const userData = {
      nullifier_hash: data.nullifier_hash,
      merkle_root: data.merkle_root,
      proof: data.proof,
      verified_at: new Date().toISOString()
    }

    setWorldcoinUser(userData)
    setWorldcoinVerified(true)
    setVerificationError(null)

    // Store in localStorage for persistence
    localStorage.setItem('worldcoin_user', JSON.stringify(userData))
    localStorage.setItem('worldcoin_verified', 'true')
  }, [])

  const handleVerificationError = useCallback((error) => {
    console.error('Worldcoin verification error:', error)
    setVerificationError(String(error))
    setWorldcoinVerified(false)
    setWorldcoinUser(null)
  }, [])

  const logout = useCallback(() => {
    setWorldcoinUser(null)
    setWorldcoinVerified(false)
    setVerificationError(null)
    localStorage.removeItem('worldcoin_user')
    localStorage.removeItem('worldcoin_verified')
  }, [])

  // Load from localStorage on mount
  const loadStoredUser = useCallback(() => {
    const stored = localStorage.getItem('worldcoin_user')
    const verified = localStorage.getItem('worldcoin_verified') === 'true'

    if (stored && verified) {
      try {
        const userData = JSON.parse(stored)
        setWorldcoinUser(userData)
        setWorldcoinVerified(true)
      } catch (e) {
        console.error('Failed to load stored Worldcoin user:', e)
        logout()
      }
    }
  }, [logout])

  return (
    <WorldcoinContext.Provider
      value={{
        worldcoinUser,
        worldcoinVerified,
        verificationError,
        isVerifying,
        setIsVerifying,
        handleVerificationSuccess,
        handleVerificationError,
        logout,
        loadStoredUser
      }}
    >
      {children}
    </WorldcoinContext.Provider>
  )
}
