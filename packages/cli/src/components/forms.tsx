/**
 * Interactive form components for TUI
 */
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import * as readline from 'readline';
import { defaultTheme } from './index.js';

interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

/**
 * Interactive select menu - requires stdin input with improved polish
 */
export function SelectMenu({
  options,
  onSelect,
  onBack,
  title,
  footerHint,
  pageSize = 10,
}: {
  options: SelectOption[];
  onSelect: (value: string) => void;
  onBack?: () => void;
  title?: string;
  footerHint?: string;
  pageSize?: number;
}) {
  const [selected, setSelected] = useState(0);
  const [done, setDone] = useState(false);
  const [page, setPage] = useState(0);

  const startIdx = page * pageSize;
  const endIdx = Math.min(startIdx + pageSize, options.length);
  const currentPage = options.slice(startIdx, endIdx);
  const totalPages = Math.ceil(options.length / pageSize);

  useEffect(() => {
    const handleKeyPress = (buffer: any, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        process.exit(0);
      }

      if (key && key.name === 'up') {
        if (selected > 0) {
          setSelected(selected - 1);
        } else {
          setSelected(options.length - 1);
          setPage(Math.floor((options.length - 1) / pageSize));
        }
      }
      if (key && key.name === 'down') {
        if (selected < options.length - 1) {
          setSelected(selected + 1);
        } else {
          setSelected(0);
          setPage(0);
        }
      }
      if (key && key.name === 'pageup') {
        const newPage = Math.max(0, page - 1);
        setPage(newPage);
        setSelected(newPage * pageSize);
      }
      if (key && key.name === 'pagedown') {
        const newPage = Math.min(totalPages - 1, page + 1);
        setPage(newPage);
        setSelected(newPage * pageSize);
      }
      if (key && key.name === 'return') {
        setDone(true);
        const selectedOption = options[selected];
        if (selectedOption) {
          onSelect(selectedOption.value);
        }
      }
      if (key && (key.name === 'escape' || key.name === 'left') && onBack) {
        setDone(true);
        onBack();
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', handleKeyPress);

    return () => {
      process.stdin.off('keypress', handleKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };
  }, [options, selected, page, pageSize, totalPages, onSelect]);

  // Update page when selected item is out of view
  useEffect(() => {
    const requiredPage = Math.floor(selected / pageSize);
    if (requiredPage !== page) {
      setPage(requiredPage);
    }
  }, [selected, pageSize, page]);

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={defaultTheme.primary} bold>
            {title}
          </Text>
        </Box>
      )}
      {currentPage.map((option, i) => {
        const actualIndex = startIdx + i;
        const isSelected = actualIndex === selected;

        return (
          <Box key={i} flexDirection="column" marginY={0}>
            <Box>
              <Text color={defaultTheme.primary} bold={isSelected}>
                {isSelected ? '❯ ' : '  '}
              </Text>
              <Text bold={isSelected} color={isSelected ? defaultTheme.primary : defaultTheme.primary}>
                {option.label}
              </Text>
            </Box>
            {option.description && isSelected && (
              <Box marginTop={0}>
                <Box width={2} />
                <Text color={defaultTheme.muted}>{option.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}
      {!done && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={defaultTheme.muted}>↑↓ Navigate • Enter to select{onBack ? ' • Esc to go back' : ''}</Text>
          {footerHint && <Text color={defaultTheme.muted}>{footerHint}</Text>}
          {totalPages > 1 && (
            <Text color={defaultTheme.muted}>
              Page {page + 1} of {totalPages}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

/**
 * Text input component with validation and better feedback
 */
export function TextInput({
  prompt,
  onSubmit,
  onCancel,
  defaultValue = '',
  placeholder = '',
  required = false,
}: {
  prompt: string;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const promptText = defaultValue ? `${prompt} [${defaultValue}]` : prompt;
    rl.question(`${promptText}: `, (answer) => {
      const finalValue = answer || defaultValue || '';
      if (required && !finalValue.trim()) {
        setError('This field is required');
        rl.close();
      } else {
        setSubmitted(true);
        onSubmit(finalValue);
        rl.close();
      }
    });

    return () => rl.close();
  }, [prompt, onSubmit, defaultValue, required]);

  return submitted ? null : (
    <Box flexDirection="column">
      <Box>
        <Text>{prompt} </Text>
        {placeholder && <Text color={defaultTheme.muted}>{placeholder}</Text>}
      </Box>
      {error && (
        <Box marginTop={0}>
          <Text color={defaultTheme.error}>{error}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Checkbox list component with improved polish
 */
export function CheckboxList({
  options,
  onConfirm,
  title,
  pageSize = 10,
}: {
  options: SelectOption[];
  onConfirm: (selected: string[]) => void;
  title?: string;
  pageSize?: number;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cursorPos, setCursorPos] = useState(0);
  const [done, setDone] = useState(false);
  const [page, setPage] = useState(0);

  const startIdx = page * pageSize;
  const endIdx = Math.min(startIdx + pageSize, options.length);
  const currentPage = options.slice(startIdx, endIdx);
  const totalPages = Math.ceil(options.length / pageSize);

  useEffect(() => {
    const handleKeyPress = (buffer: any, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        process.exit(0);
      }

      if (key && key.name === 'up') {
        if (cursorPos > 0) {
          setCursorPos(cursorPos - 1);
        } else {
          setCursorPos(options.length - 1);
          setPage(Math.floor((options.length - 1) / pageSize));
        }
      }
      if (key && key.name === 'down') {
        if (cursorPos < options.length - 1) {
          setCursorPos(cursorPos + 1);
        } else {
          setCursorPos(0);
          setPage(0);
        }
      }
      if (key && key.name === 'space') {
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(cursorPos)) {
            next.delete(cursorPos);
          } else {
            next.add(cursorPos);
          }
          return next;
        });
      }
      if (key && key.name === 'return') {
        setDone(true);
        const selectedValues = Array.from(selected)
          .map((i) => options[i])
          .filter((opt) => opt !== undefined)
          .map((opt) => opt.value);
        onConfirm(selectedValues);
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', handleKeyPress);

    return () => {
      process.stdin.off('keypress', handleKeyPress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };
  }, [options, cursorPos, selected, page, pageSize, onConfirm]);

  // Update page when cursor is out of view
  useEffect(() => {
    const requiredPage = Math.floor(cursorPos / pageSize);
    if (requiredPage !== page) {
      setPage(requiredPage);
    }
  }, [cursorPos, pageSize, page]);

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={defaultTheme.primary} bold>
            {title}
          </Text>
        </Box>
      )}
      {currentPage.map((option, i) => {
        const actualIndex = startIdx + i;
        const isCursorHere = actualIndex === cursorPos;
        const isSelected = selected.has(actualIndex);

        return (
          <Box key={i} flexDirection="column" marginY={0}>
            <Box>
              <Text color={defaultTheme.primary} bold={isCursorHere}>
                {isCursorHere ? '❯ ' : '  '}
              </Text>
              <Text color={defaultTheme.primary}>{isSelected ? '☑' : '☐'} </Text>
              <Text bold={isCursorHere}>{option.label}</Text>
            </Box>
            {option.description && isCursorHere && (
              <Box marginTop={0}>
                <Box width={2} />
                <Text color={defaultTheme.muted}>{option.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}
      {!done && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={defaultTheme.muted}>↑↓ Navigate • Space to select • Enter to confirm</Text>
          {totalPages > 1 && (
            <Text color={defaultTheme.muted}>
              Page {page + 1} of {totalPages}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
