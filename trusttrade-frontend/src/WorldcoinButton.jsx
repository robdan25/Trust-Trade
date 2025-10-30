import { useContext, useEffect } from 'react'
import { IDKitWidget } from '@worldcoin/idkit'
import { WorldcoinContext } from './WorldcoinContext'

const APP_ID = import.meta.env.VITE_WORLDCOIN_APP_ID || 'app_staging_8e2e5c62e9e8c6f8e9e2e5c62e9e8c6f'
const ACTION = import.meta.env.VITE_WORLDCOIN_ACTION || 'verify_trusttrade'

export function WorldcoinButton() {
  const {
    worldcoinUser,
    worldcoinVerified,
    verificationError,
    isVerifying,
    setIsVerifying,
    handleVerificationSuccess,
    handleVerificationError,
    logout,
    loadStoredUser
  } = useContext(WorldcoinContext)

  useEffect(() => {
    loadStoredUser()
  }, [loadStoredUser])

  const onSuccess = (data) => {
    console.log('Worldcoin verification success:', data)
    setIsVerifying(false)
    handleVerificationSuccess(data)
  }

  const onError = (error) => {
    console.error('Worldcoin verification error:', error)
    setIsVerifying(false)
    handleVerificationError(error)
  }

  if (worldcoinVerified && worldcoinUser) {
    return (
      <div className="worldcoin-status">
        <div className="verified-badge">
          <span className="badge-icon">🌍</span>
          <span className="badge-text">Verified with World ID</span>
        </div>
        <button
          className="btn-secondary"
          onClick={logout}
          title="Logout from World ID"
        >
          Logout World ID
        </button>
      </div>
    )
  }

  return (
    <div className="worldcoin-container">
      <IDKitWidget
        app_id={APP_ID}
        action={ACTION}
        onSuccess={onSuccess}
        onError={onError}
        handleVerify={(verificationResponse) => {
          // Send verification to backend
          console.log('Verification response:', verificationResponse)
        }}
      >
        {({ open }) => (
          <button
            className="btn-worldcoin"
            onClick={() => {
              setIsVerifying(true)
              open()
            }}
            disabled={isVerifying}
          >
            {isVerifying ? 'Verifying...' : '🌍 Verify with World ID'}
          </button>
        )}
      </IDKitWidget>

      {verificationError && (
        <div className="alert-error" style={{ marginTop: '10px' }}>
          {verificationError}
        </div>
      )}
    </div>
  )
}
