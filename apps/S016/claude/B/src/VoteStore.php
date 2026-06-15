<?php
declare(strict_types=1);

namespace Poll;

use RuntimeException;

/**
 * File-backed vote tally with concurrency-safe reads and writes.
 *
 * Storage is a JSON object mapping option key => integer count. An exclusive
 * file lock (flock) serialises concurrent writers so simultaneous votes are
 * never lost or corrupted.
 */
final class VoteStore
{
    /** @var string */
    private $file;

    /** @var array<string,string> validOptions: key => label */
    private $validOptions;

    /**
     * @param array<string,string> $validOptions Allowed option keys (whitelist).
     */
    public function __construct(string $file, array $validOptions)
    {
        $this->file = $file;
        $this->validOptions = $validOptions;
        $this->ensureStorage();
    }

    private function ensureStorage(): void
    {
        $dir = dirname($this->file);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Storage directory could not be created.');
        }
        if (!file_exists($this->file)) {
            $seed = [];
            foreach (array_keys($this->validOptions) as $key) {
                $seed[$key] = 0;
            }
            $this->atomicWrite($seed);
        }
    }

    /**
     * Record a vote for a whitelisted option key. Unknown keys are rejected.
     *
     * @return array<string,int> The updated tally.
     */
    public function record(string $optionKey): array
    {
        if (!array_key_exists($optionKey, $this->validOptions)) {
            throw new RuntimeException('Invalid option.');
        }

        $fp = fopen($this->file, 'c+');
        if ($fp === false) {
            throw new RuntimeException('Storage unavailable.');
        }

        try {
            if (!flock($fp, LOCK_EX)) {
                throw new RuntimeException('Could not lock storage.');
            }

            $raw = stream_get_contents($fp);
            $tally = $this->normalise(json_decode($raw ?: '[]', true));
            $tally[$optionKey] = ($tally[$optionKey] ?? 0) + 1;

            // Rewrite the file atomically under the held lock.
            rewind($fp);
            ftruncate($fp, 0);
            fwrite($fp, $this->encode($tally));
            fflush($fp);

            return $tally;
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    /**
     * @return array<string,int> The current tally for all valid options.
     */
    public function tally(): array
    {
        $raw = is_readable($this->file) ? file_get_contents($this->file) : '';
        return $this->normalise(json_decode($raw ?: '[]', true));
    }

    /**
     * Coerce stored data into a clean key => int map restricted to valid options.
     *
     * @param mixed $data
     * @return array<string,int>
     */
    private function normalise($data): array
    {
        $result = [];
        foreach (array_keys($this->validOptions) as $key) {
            $value = (is_array($data) && isset($data[$key]) && is_numeric($data[$key]))
                ? (int) $data[$key]
                : 0;
            $result[$key] = max(0, $value);
        }
        return $result;
    }

    /** @param array<string,int> $tally */
    private function encode(array $tally): string
    {
        return json_encode($tally, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
    }

    /** @param array<string,int> $tally */
    private function atomicWrite(array $tally): void
    {
        $tmp = $this->file . '.tmp';
        if (file_put_contents($tmp, $this->encode($tally), LOCK_EX) === false) {
            throw new RuntimeException('Could not initialise storage.');
        }
        rename($tmp, $this->file);
    }
}
