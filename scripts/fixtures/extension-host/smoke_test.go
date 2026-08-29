package main

import "testing"

type Reader interface {
	Read([]byte) (int, error)
}

type Person struct{}

func (Person) Read([]byte) (int, error) {
	return 0, nil
}

func TestScenarios(t *testing.T) {
	tests := []struct {
		name string
	}{
		{name: "first"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {})
	}
}

func main() {}
