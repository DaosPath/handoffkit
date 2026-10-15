package security

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"os"
	"reflect"
	"sort"
)

const (
	SecurityTranscriptFormat        = "handoffkit.security.transcript"
	SecurityTranscriptFormatVersion = 1
)

type SecurityTranscript struct {
	BindingHash                   string  `json:"binding_hash"`
	BindingType                   string  `json:"binding_type"`
	CapabilitiesHash              string  `json:"capabilities_hash"`
	Format                        string  `json:"format"`
	FormatVersion                 int     `json:"format_version"`
	HandshakeNonce                string  `json:"handshake_nonce"`
	NegotiatedGroup               *string `json:"negotiated_group"`
	ProtocolVersion               string  `json:"protocol_version"`
	ReceiverCredentialFingerprint string  `json:"receiver_credential_fingerprint"`
	ReceiverNodeID                string  `json:"receiver_node_id"`
	ReceiverPeerID                string  `json:"receiver_peer_id"`
	RequestedProfile              string  `json:"requested_profile"`
	SelectedProfile               string  `json:"selected_profile"`
	SenderCredentialFingerprint   string  `json:"sender_credential_fingerprint"`
	SenderNodeID                  string  `json:"sender_node_id"`
	SenderPeerID                  string  `json:"sender_peer_id"`
	SessionID                     string  `json:"session_id"`
	Timestamp                     string  `json:"timestamp"`
	TLSVersion                    string  `json:"tls_version"`
	TranscriptHash                string  `json:"transcript_hash"`
}

type SecurityTranscriptInput struct {
	ProtocolVersion  string
	RequestedProfile SecurityProfile
	SelectedProfile  SecurityProfile
	Sender           *PeerIdentity
	Receiver         *PeerIdentity
	TLSVersion       string
	NegotiatedGroup  *string
	SessionID        string
	HandshakeNonce   string
	Timestamp        string
}

func BuildSecurityTranscript(input SecurityTranscriptInput) (SecurityTranscript, error) {
	if input.Sender == nil || input.Receiver == nil {
		return SecurityTranscript{}, securityError("security_transcript_invalid", "security transcript requires both TLS endpoint identities", nil)
	}
	capabilities := append([]string(nil), input.Sender.Capabilities...)
	sort.Strings(capabilities)
	capabilitiesHash, err := canonicalSHA256(capabilities)
	if err != nil {
		return SecurityTranscript{}, err
	}
	bindingHash, err := canonicalSHA256(map[string]any{
		"receiver_credential_fingerprint": NormalizeFingerprint(input.Receiver.CredentialFingerprint),
		"sender_credential_fingerprint":   NormalizeFingerprint(input.Sender.CredentialFingerprint),
		"tls_version":                     input.TLSVersion,
	})
	if err != nil {
		return SecurityTranscript{}, err
	}
	transcript := SecurityTranscript{
		BindingHash:                   bindingHash,
		BindingType:                   "tls-certificate-endpoints",
		CapabilitiesHash:              capabilitiesHash,
		Format:                        SecurityTranscriptFormat,
		FormatVersion:                 SecurityTranscriptFormatVersion,
		HandshakeNonce:                input.HandshakeNonce,
		NegotiatedGroup:               input.NegotiatedGroup,
		ProtocolVersion:               input.ProtocolVersion,
		ReceiverCredentialFingerprint: NormalizeFingerprint(input.Receiver.CredentialFingerprint),
		ReceiverNodeID:                input.Receiver.NodeID,
		ReceiverPeerID:                input.Receiver.PeerID,
		RequestedProfile:              string(input.RequestedProfile),
		SelectedProfile:               string(input.SelectedProfile),
		SenderCredentialFingerprint:   NormalizeFingerprint(input.Sender.CredentialFingerprint),
		SenderNodeID:                  input.Sender.NodeID,
		SenderPeerID:                  input.Sender.PeerID,
		SessionID:                     input.SessionID,
		Timestamp:                     input.Timestamp,
		TLSVersion:                    input.TLSVersion,
	}
	if err := transcript.validateFields(false); err != nil {
		return SecurityTranscript{}, err
	}
	transcript.TranscriptHash, err = canonicalSHA256(transcript.unsignedMap())
	if err != nil {
		return SecurityTranscript{}, err
	}
	return transcript, nil
}

func ParseSecurityTranscript(value any) (SecurityTranscript, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return SecurityTranscript{}, securityError("security_transcript_invalid", "security transcript is malformed", nil)
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var transcript SecurityTranscript
	if err := decoder.Decode(&transcript); err != nil {
		return SecurityTranscript{}, securityError("security_transcript_invalid", "security transcript is malformed", nil)
	}
	if err := transcript.validateFields(true); err != nil {
		return SecurityTranscript{}, err
	}
	digest, err := canonicalSHA256(transcript.unsignedMap())
	if err != nil {
		return SecurityTranscript{}, err
	}
	if subtle.ConstantTimeCompare([]byte(transcript.TranscriptHash), []byte(digest)) != 1 {
		return SecurityTranscript{}, securityError("security_transcript_hash_mismatch", "security transcript hash does not match its canonical payload", nil)
	}
	return transcript, nil
}

func VerifySecurityTranscript(value any, input SecurityTranscriptInput) (SecurityTranscript, error) {
	transcript, err := ParseSecurityTranscript(value)
	if err != nil {
		return SecurityTranscript{}, err
	}
	expected, err := BuildSecurityTranscript(input)
	if err != nil {
		return SecurityTranscript{}, err
	}
	profile := string(input.SelectedProfile)
	if transcript.RequestedProfile != profile || transcript.SelectedProfile != profile {
		return SecurityTranscript{}, securityError("security_profile_mismatch", "security transcript attempted a profile downgrade", map[string]any{
			"requested": transcript.RequestedProfile,
			"selected":  transcript.SelectedProfile,
			"required":  profile,
		})
	}
	if transcript.SenderPeerID != expected.SenderPeerID ||
		transcript.SenderNodeID != expected.SenderNodeID ||
		transcript.SenderCredentialFingerprint != expected.SenderCredentialFingerprint ||
		transcript.ReceiverPeerID != expected.ReceiverPeerID ||
		transcript.ReceiverNodeID != expected.ReceiverNodeID ||
		transcript.ReceiverCredentialFingerprint != expected.ReceiverCredentialFingerprint {
		return SecurityTranscript{}, securityError("security_transcript_identity_mismatch", "security transcript identities do not match authenticated TLS endpoints", nil)
	}
	if !reflect.DeepEqual(transcript, expected) {
		return SecurityTranscript{}, securityError("security_transcript_mismatch", "security transcript does not match the authenticated HK-CSP exchange", nil)
	}
	return transcript, nil
}

func (transcript SecurityTranscript) unsignedMap() map[string]any {
	return map[string]any{
		"binding_hash":                    transcript.BindingHash,
		"binding_type":                    transcript.BindingType,
		"capabilities_hash":               transcript.CapabilitiesHash,
		"format":                          transcript.Format,
		"format_version":                  transcript.FormatVersion,
		"handshake_nonce":                 transcript.HandshakeNonce,
		"negotiated_group":                transcript.NegotiatedGroup,
		"protocol_version":                transcript.ProtocolVersion,
		"receiver_credential_fingerprint": transcript.ReceiverCredentialFingerprint,
		"receiver_node_id":                transcript.ReceiverNodeID,
		"receiver_peer_id":                transcript.ReceiverPeerID,
		"requested_profile":               transcript.RequestedProfile,
		"selected_profile":                transcript.SelectedProfile,
		"sender_credential_fingerprint":   transcript.SenderCredentialFingerprint,
		"sender_node_id":                  transcript.SenderNodeID,
		"sender_peer_id":                  transcript.SenderPeerID,
		"session_id":                      transcript.SessionID,
		"timestamp":                       transcript.Timestamp,
		"tls_version":                     transcript.TLSVersion,
	}
}

func (transcript SecurityTranscript) validateFields(requireHash bool) error {
	if transcript.Format != SecurityTranscriptFormat {
		return securityError("security_transcript_invalid", "security transcript format is not recognized", nil)
	}
	if transcript.FormatVersion != SecurityTranscriptFormatVersion {
		return securityError("security_transcript_version", "security transcript format version is unavailable", nil)
	}
	for _, value := range []string{
		transcript.BindingHash, transcript.BindingType, transcript.CapabilitiesHash,
		transcript.HandshakeNonce, transcript.ProtocolVersion,
		transcript.ReceiverCredentialFingerprint, transcript.ReceiverNodeID,
		transcript.ReceiverPeerID, transcript.RequestedProfile, transcript.SelectedProfile,
		transcript.SenderCredentialFingerprint, transcript.SenderNodeID,
		transcript.SenderPeerID, transcript.SessionID, transcript.Timestamp, transcript.TLSVersion,
	} {
		if value == "" {
			return securityError("security_transcript_invalid", "security transcript contains an empty required field", nil)
		}
	}
	for _, value := range []string{
		transcript.BindingHash, transcript.CapabilitiesHash,
		transcript.ReceiverCredentialFingerprint, transcript.SenderCredentialFingerprint,
	} {
		if !isCanonicalSHA256(value) {
			return securityError("security_transcript_invalid", "security transcript contains an invalid SHA-256 value", nil)
		}
	}
	if requireHash && !isCanonicalSHA256(transcript.TranscriptHash) {
		return securityError("security_transcript_invalid", "security transcript hash is invalid", nil)
	}
	return nil
}

func canonicalSHA256(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(digest[:]), nil
}

func isCanonicalSHA256(value string) bool {
	if len(value) != 71 || value[:7] != "sha256:" {
		return false
	}
	digest, err := hex.DecodeString(value[7:])
	return err == nil && len(digest) == sha256.Size && value == "sha256:"+hex.EncodeToString(digest)
}

func PeerIdentityFromCertificate(certificate *x509.Certificate, capabilities []string) (*PeerIdentity, error) {
	if certificate == nil {
		return nil, errors.New("certificate must not be nil")
	}
	if len(certificate.URIs) != 1 || certificate.URIs[0].Scheme != "spiffe" {
		return nil, securityError("identity_san_invalid", "certificate must contain exactly one HK-CSP identity URI SAN", nil)
	}
	peerID, nodeID, workerID, trustDomain, err := parseIdentityURI(certificate.URIs[0].String())
	if err != nil {
		return nil, err
	}
	return &PeerIdentity{
		PeerID: peerID, NodeID: nodeID, WorkerID: workerID, TrustDomain: trustDomain,
		CredentialFingerprint: CertificateFingerprint(certificate),
		Capabilities:          append([]string(nil), capabilities...),
		IssuedAt:              certificate.NotBefore.Unix(), ExpiresAt: certificate.NotAfter.Unix(),
	}, nil
}

func PeerIdentityFromCertificatePath(path string, capabilities []string) (*PeerIdentity, error) {
	encoded, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(encoded)
	if block == nil {
		return nil, errors.New("certificate file contains no PEM certificate")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, err
	}
	return PeerIdentityFromCertificate(certificate, capabilities)
}

func PeerIdentityFromTLSConfig(config *tls.Config, capabilities []string) (*PeerIdentity, error) {
	if config == nil || len(config.Certificates) == 0 || len(config.Certificates[0].Certificate) == 0 {
		return nil, securityError("local_certificate_missing", "TLS config has no local certificate", nil)
	}
	certificate, err := x509.ParseCertificate(config.Certificates[0].Certificate[0])
	if err != nil {
		return nil, err
	}
	return PeerIdentityFromCertificate(certificate, capabilities)
}
