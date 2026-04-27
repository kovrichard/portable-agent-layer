<!-- .slide: data-layout="code" -->
## Code layout

```python
def fibonacci(n: int) -> int:
    """Iterative — O(n) time, O(1) space."""
    if n < 2:
        return n
    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b


print([fibonacci(i) for i in range(10)])
# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

Note: Syntax highlighting via the bundled highlight.js — supports 30+ languages out of the box.
