<?php
/** @var array<int,array<string,mixed>> $rows */
/** @var int $totalCents */
/** @var array{id:int,email:string,name:string,role:string}|null $currentUser */
use App\Csrf;
use function App\e;
use function App\money;
?>
<h1>Your cart</h1>

<?php if ($rows === []): ?>
    <div class="empty">Your cart is empty. <a href="/">Start shopping</a>.</div>
<?php else: ?>
    <table>
        <thead>
            <tr>
                <th>Product</th><th>Vendor</th><th class="right">Price</th>
                <th>Qty</th><th class="right">Subtotal</th><th></th>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($rows as $r): ?>
            <tr>
                <td><a href="/product?id=<?= (int) $r['id'] ?>"><?= e($r['name']) ?></a></td>
                <td class="muted"><?= e($r['vendor']) ?></td>
                <td class="right"><?= e(money((int) $r['price_cents'])) ?></td>
                <td>
                    <form method="post" action="/cart/update" class="inline" style="display:flex; gap:6px">
                        <?= Csrf::field() ?>
                        <input type="hidden" name="product_id" value="<?= (int) $r['id'] ?>">
                        <input class="qtybox" type="number" name="quantity" value="<?= (int) $r['quantity'] ?>" min="0" max="<?= min(99, (int) $r['stock']) ?>">
                        <button class="btn btn-sm btn-ghost" type="submit">Update</button>
                    </form>
                </td>
                <td class="right"><?= e(money((int) $r['line_total'])) ?></td>
                <td>
                    <form method="post" action="/cart/remove" class="inline">
                        <?= Csrf::field() ?>
                        <input type="hidden" name="product_id" value="<?= (int) $r['id'] ?>">
                        <button class="linkbtn" type="submit">Remove</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
        <tfoot>
            <tr>
                <th colspan="4" class="right">Total</th>
                <th class="right"><?= e(money((int) $totalCents)) ?></th>
                <th></th>
            </tr>
        </tfoot>
    </table>

    <div style="margin-top:18px; display:flex; gap:12px; align-items:center">
        <?php if ($currentUser !== null && $currentUser['role'] === 'buyer'): ?>
            <form method="post" action="/checkout">
                <?= Csrf::field() ?>
                <button class="btn" type="submit">Checkout</button>
            </form>
        <?php elseif ($currentUser === null): ?>
            <a class="btn" href="/login">Sign in as a buyer to checkout</a>
        <?php else: ?>
            <span class="muted">Vendor accounts cannot place orders. Sign in with a buyer account to checkout.</span>
        <?php endif; ?>
        <a href="/">Continue shopping</a>
    </div>
<?php endif; ?>
