package runtime

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/DaosPath/handoffkit/go/contract"
)

type DedupStore interface {
	Claim(string) (bool, error)
	Release(string) (bool, error)
	Contains(string) bool
}

type dedupRecord struct {
	Operation string `json:"op"`
	Key       string `json:"key"`
	Timestamp string `json:"timestamp"`
}

type FileDedupStore struct {
	path        string
	capacity    int
	maxLogBytes int64
	mu          sync.Mutex
	keys        map[string]struct{}
	order       []string
}

func NewFileDedupStore(path string, capacity int, maxLogBytes int64) (*FileDedupStore, error) {
	if capacity < 1 || maxLogBytes < 1024 {
		return nil, errors.New("dedup store limits are invalid")
	
	
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	
	
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return nil, err
	
	
	}
	file, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDONLY, 0o600)
	if err != nil {
		return nil, err
	
	
	}
	defer file.Close()
	store := &FileDedupStore{path: absolute, capacity: capacity, maxLogBytes: maxLogBytes, keys: map[string]struct{}{}}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 4096)
	for scanner.Scan() {
		var record dedupRecord
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			return nil, errors.New("invalid dedup log")
		
		
		}
		key, err := validateDedupKey(record.Key)
		if err != nil {
			return nil, err
		
		
		}
		if record.Operation == "claim" {
			store.removeOrder(key)
			store.keys[key] = struct{}{}
			store.order = append(store.order, key)
		} else if record.Operation == "release" {
			delete(store.keys, key)
			store.removeOrder(key)
		} else {
			return nil, errors.New("invalid dedup log operation")
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	
	
	}
	store.trim()
	return store, nil
}

func (s *FileDedupStore) Claim(value string) (bool, error) {
	key, err := validateDedupKey(value)
	if err != nil {
		return false, err
	
	
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.keys[key]; exists {
		return false, nil
	
	
	}
	s.keys[key] = struct{}{}
	s.order = append(s.order, key)
	s.trim()
	if err := s.append(dedupRecord{"claim", key, contract.UTCNow()}); err != nil {
		delete(s.keys, key)
		s.removeOrder(key)
		return false, err
	}
	return true, nil
}

func (s *FileDedupStore) Release(value string) (bool, error) {
	key, err := validateDedupKey(value)
	if err != nil {
		return false, err
	
	
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.keys[key]; !exists {
		return false, nil
	
	
	}
	delete(s.keys, key)
	s.removeOrder(key)
	if err := s.append(dedupRecord{"release", key, contract.UTCNow()}); err != nil {
		s.keys[key] = struct{}{}
		s.order = append(s.order, key)
		return false, err
	}
	return true, nil
}

func (s *FileDedupStore) Contains(value string) bool {
	key, err := validateDedupKey(value)
	if err != nil {
		return false
	
	
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, exists := s.keys[key]
	return exists
}

func (s *FileDedupStore) append(record dedupRecord) error {
	file, err := os.OpenFile(s.path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return err
	
	
	}
	encoded, err := json.Marshal(record)
	if err == nil {
		_, err = file.Write(append(encoded, '\n'))
	}
	if syncErr := file.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	
	
	}
	info, err := os.Stat(s.path)
	if err == nil && info.Size() > s.maxLogBytes {
		return s.compact()
	
	
	}
	return err
}

func (s *FileDedupStore) compact() error {
	temporary := fmt.Sprintf("%s.%d.tmp", s.path, os.Getpid())
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	
	
	}
	encoder := json.NewEncoder(file)
	for _, key := range s.order {
		if err := encoder.Encode(dedupRecord{"claim", key, contract.UTCNow()}); err != nil {
			file.Close()
			os.Remove(temporary)
			return err
		}
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(temporary)
		return err
	}
	if err := file.Close(); err != nil {
		os.Remove(temporary)
		return err
	}
	_ = os.Remove(s.path)
	return os.Rename(temporary, s.path)
}

func (s *FileDedupStore) trim() {
	for len(s.order) > s.capacity {
		delete(s.keys, s.order[0])
		s.order = s.order[1:]
	}
}

func (s *FileDedupStore) removeOrder(key string) {
	for index, current := range s.order {
		if current == key {
			s.order = append(s.order[:index], s.order[index+1:]...)
			return
		}
	}
}

func validateDedupKey(value string) (string, error) {
	key := strings.TrimSpace(value)
	if key == "" {
		return "", errors.New("idempotency key must not be empty")
	
	
	}
	if len([]byte(key)) > 1024 {
		return "", errors.New("idempotency key must not exceed 1024 bytes")
	
	
	}
	return key, nil
}
