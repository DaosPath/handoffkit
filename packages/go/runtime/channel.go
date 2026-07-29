package runtime

import (
	"context"
	"errors"
	"sync"

	"github.com/DaosPath/handoffkit/go/contract"
)

type Channel struct {
	config contract.ChannelConfig
	max    int
	mu     sync.Mutex
	queue  []contract.MessageEnvelope
	closed bool
	change chan struct{}
}

func NewChannel(config contract.ChannelConfig, maxMessageBytes int) (*Channel, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	
	
	}
	if maxMessageBytes < contract.MinMessageBytes || maxMessageBytes > contract.DefaultMaxMessageBytes {
		return nil, errors.New("max message bytes is outside protocol limits")
	
	
	}
	return &Channel{config: config, max: maxMessageBytes, queue: make([]contract.MessageEnvelope, 0, config.Capacity), change: make(chan struct{})}, nil
}

func (c *Channel) Send(ctx context.Context, envelope contract.MessageEnvelope) error {
	if envelope.Channel != c.config.Name {
		return errors.New("envelope channel does not match channel")
	
	
	}
	encoded, err := envelope.Encode()
	if err != nil {
		return err
	
	
	}
	if len(encoded) > c.max {
		return errors.New("message exceeds channel limit")
	
	
	}
	for {
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			return runtimeError("channel_closed", "channel is closed", false)
		}
		if len(c.queue) < c.config.Capacity {
			c.queue = append(c.queue, envelope)
			c.signalLocked()
			c.mu.Unlock()
			return nil
		}
		if c.config.OverflowPolicy == contract.OverflowReject {
			c.mu.Unlock()
			return runtimeError("backpressure", "channel is at capacity", true)
		}
		change := c.change
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-change:
		}
	}
}

func (c *Channel) Receive(ctx context.Context) (contract.MessageEnvelope, error) {
	for {
		c.mu.Lock()
		if len(c.queue) > 0 {
			envelope := c.queue[0]
			copy(c.queue, c.queue[1:])
			c.queue = c.queue[:len(c.queue)-1]
			c.signalLocked()
			c.mu.Unlock()
			return envelope, nil
		}
		if c.closed {
			c.mu.Unlock()
			return contract.MessageEnvelope{}, runtimeError("channel_closed", "channel is closed", false)
		}
		change := c.change
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return contract.MessageEnvelope{}, ctx.Err()
		case <-change:
		}
	}
}

func (c *Channel) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return 	
	}
	c.closed = true
	c.signalLocked()
}

func (c *Channel) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.queue)
}

func (c *Channel) Closed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

func (c *Channel) signalLocked() {
	close(c.change)
	c.change = make(chan struct{})
}
