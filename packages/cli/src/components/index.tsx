/**
 * Shared TUI components for OpenForge CLI
 */
import React from 'react';
import { Box, Text } from 'ink';

export interface Theme {
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  muted: string;
  border: string;
}

export const defaultTheme: Theme = {
  primary: 'white',
  secondary: 'gray',
  accent: 'yellow',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'white',
  muted: 'gray',
  border: 'gray',
};

/**
 * Header component - displays title with consistent styling
 */
export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <Box flexDirection="column" marginBottom={2}>
      <Box marginBottom={1}>
        <Text color={defaultTheme.primary} bold>
          ✨ {title}
        </Text>
      </Box>
      {subtitle && (
        <Box>
          <Text color={defaultTheme.muted}>{subtitle}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={defaultTheme.border}>{'─'.repeat(50)}</Text>
      </Box>
    </Box>
  );
}

/**
 * Section component - groups content with visual separation
 */
export function Section({
  title,
  children,
  variant = 'default',
}: {
  title?: string;
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'error' | 'warning';
}) {
  const variantColors = {
    default: defaultTheme.border,
    primary: defaultTheme.primary,
    success: defaultTheme.success,
    error: defaultTheme.error,
    warning: defaultTheme.warning,
  };

  const borderColor = variantColors[variant];

  return (
    <Box flexDirection="column" marginBottom={2} borderStyle="round" borderColor={borderColor} paddingX={2} paddingY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={borderColor} bold>
            {title}
          </Text>
        </Box>
      )}
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

/**
 * Loading spinner component with multiple animation styles
 */
export function Spinner({ text, style = 'dots' }: { text: string; style?: 'dots' | 'bars' | 'line' | 'pipe' }) {
  const frames = {
    dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    bars: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
    line: ['⠂', '-', '–', '—', '–', '-'],
    pipe: ['┤', '┘', '┴', '└', '├', '┌', '┬', '┐'],
  };

  const selectedFrames = frames[style];
  const [frame, setFrame] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % selectedFrames.length);
    }, 80);
    return () => clearInterval(interval);
  }, [selectedFrames.length]);

  return (
    <Box>
      <Text color={defaultTheme.primary}>{selectedFrames[frame]} </Text>
      <Text>{text}</Text>
    </Box>
  );
}

/**
 * Status indicator component with better styling
 */
export function StatusBox({
  status,
  message,
  details,
}: {
  status: 'success' | 'error' | 'warning' | 'info';
  message: string;
  details?: string;
}) {
  const colors = {
    success: defaultTheme.success,
    error: defaultTheme.error,
    warning: defaultTheme.warning,
    info: defaultTheme.info,
  };

  const icons = {
    success: '✔',
    error: '✖',
    warning: '⚠',
    info: 'ℹ',
  };

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color={colors[status]} bold>
          {icons[status]} {message}
        </Text>
      </Box>
      {details && (
        <Box marginTop={1}>
          <Box width={2} />
          <Text color={defaultTheme.muted}>{details}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * List item component for displaying items with optional selection indicator
 */
export function ListItem({
  item,
  selected = false,
  description,
  highlight = false,
}: {
  item: string;
  selected?: boolean;
  description?: string;
  highlight?: boolean;
}) {
  return (
    <Box flexDirection="column" marginY={0}>
      <Box>
        <Text color={defaultTheme.primary} bold={selected}>
          {selected ? '❯ ' : '  '}
        </Text>
        <Text bold={selected} color={highlight ? defaultTheme.accent : defaultTheme.primary}>
          {item}
        </Text>
      </Box>
      {description && (
        <Box marginTop={0}>
          <Box width={2} />
          <Text color={defaultTheme.muted}>{description}</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Progress bar component with enhanced styling
 */
export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const width = 30;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percentage = Math.round(percent);

  return (
    <Box flexDirection="column" marginY={1}>
      {label && (
        <Box marginBottom={1}>
          <Text>{label}</Text>
        </Box>
      )}
      <Box>
        <Text color={defaultTheme.primary}>[{bar}] </Text>
        <Text color={percentage === 100 ? defaultTheme.success : defaultTheme.primary}>{percentage}%</Text>
      </Box>
    </Box>
  );
}

/**
 * Info box for displaying information with different styles
 */
export function InfoBox({
  title,
  content,
  type = 'default',
}: {
  title?: string;
  content: string;
  type?: 'default' | 'tip' | 'note' | 'important';
}) {
  const typeIcons = {
    default: '│',
    tip: '💡',
    note: '📝',
    important: '⭐',
  };

  const typeColors = {
    default: defaultTheme.border,
    tip: defaultTheme.primary,
    note: defaultTheme.secondary,
    important: defaultTheme.accent,
  };

  const icon = typeIcons[type];
  const color = typeColors[type];

  return (
    <Box flexDirection="column" marginY={1} paddingX={2} paddingY={1} borderStyle="single" borderColor={color}>
      {title && (
        <Box marginBottom={1}>
          <Text color={color} bold>
            {icon} {title}
          </Text>
        </Box>
      )}
      <Box>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}

/**
 * Multi-line text display component
 */
export function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}

/**
 * Highlight component for important text
 */
export function Highlight({
  text,
  color = defaultTheme.primary,
}: {
  text: string;
  color?: string;
}) {
  return <Text color={color}>{text}</Text>;
}

/**
 * Key binding hint component with better styling
 */
export function KeyHint({ keys, description }: { keys: string; description: string }) {
  return (
    <Box marginTop={1}>
      <Text color={defaultTheme.muted}>
        Press{' '}
        <Text bold color={defaultTheme.secondary}>
          {keys}
        </Text>
        {' '}to {description}
      </Text>
    </Box>
  );
}

/**
 * Divider component for visual separation
 */
export function Divider({ color = defaultTheme.border }: { color?: string }) {
  return (
    <Box marginY={1}>
      <Text color={color}>{'─'.repeat(50)}</Text>
    </Box>
  );
}

/**
 * Badge component for labels and tags
 */
export function Badge({
  text,
  color = defaultTheme.primary,
}: {
  text: string;
  color?: string;
}) {
  return (
    <Text color={color}>
      [{text}]
    </Text>
  );
}
